import {
  AssetMediaStatus,
  AssetUploadAction,
  AssetVisibility,
  type AssetMediaResponse,
} from '@immich/sdk';

import { MIME_TYPE_EXTENSIONS } from '$lib/constants';
import { checkBulkUpload } from '$lib/services/upload.service';
import { uploadStore, UploadState } from '$lib/stores/upload.store.svelte';
import { describeError } from '$lib/utils';
import { ExecutorQueue } from '$lib/utils/executor-queue';
import { hashFile } from '$lib/utils/hash-file';
import { uploadRequest } from '$lib/utils/upload-request';

/**
 * The upload orchestrator (spec §8.5).
 *
 * One file's journey — hash, pre-check, POST, bookkeeping — lives in
 * `fileUploader`; `fileUploadHandler` fans a drop/pick over the queue; the two
 * `open*` helpers are the UI entry points.
 */

/** Two at a time keeps a home connection busy without starving other requests. */
const DEFAULT_CONCURRENCY = 2;

/** Finished items leave the panel quickly; duplicates stay until dismissed. */
const DONE_ITEM_LIFETIME_MS = 1000;

const queue = new ExecutorQueue(DEFAULT_CONCURRENCY);

/**
 * Extensions the picker and drop filter accept. Empty until
 * `setSupportedMediaTypes` runs, and an empty list accepts everything: better
 * to let the server reject one file with a clear message than to silently
 * ignore a format we simply have not learned about yet.
 */
let extensions: string[] = [];

export interface FileUploadHandlerOptions {
  files: File[];
  albumId?: string;
  isLockedAssets?: boolean;
}

export interface FileUploaderOptions {
  assetFile: File;
  deviceAssetId: string;
  albumId?: string;
  isLockedAssets?: boolean;
}

export interface FilePickerOptions {
  multiple?: boolean;
  extensions?: string[];
}

export function getExtensions(): string[] {
  return extensions;
}

/** Turns the server's mime-type groups into the extensions a browser filters on. */
export function setSupportedMediaTypes(mediaTypes: {
  image: string[];
  video: string[];
  sidecar: string[];
}): void {
  const resolved = [...mediaTypes.image, ...mediaTypes.video].flatMap(
    (mimeType) => MIME_TYPE_EXTENSIONS[mimeType] ?? [],
  );

  extensions = [...new Set(resolved)].sort();
}

export function setConcurrency(value: number): void {
  queue.setConcurrency(value);
}

/** True when the file's extension is one the server accepts. */
export function isSupportedFile(file: File): boolean {
  if (extensions.length === 0) {
    return true;
  }

  const name = file.name.toLowerCase();

  return extensions.some((extension) => name.endsWith(`.${extension}`));
}

/**
 * Queues every supported file and resolves with the ids of the assets that
 * were actually created. Duplicates resolve to nothing, so callers can treat
 * the result as "new assets to reveal".
 */
export async function fileUploadHandler({
  files,
  albumId,
  isLockedAssets,
}: FileUploadHandlerOptions): Promise<string[]> {
  console.log(
    '[fileUploadHandler] received',
    files.length,
    'file(s):',
    files.map((file) => file.name),
  );

  const supported = files.filter((file) => isSupportedFile(file));

  if (supported.length !== files.length) {
    console.warn(`[upload] Ignored ${files.length - supported.length} unsupported file(s)`);
  }

  const uploads = supported.map((file) => {
    const deviceAssetId = deviceAssetIdFor(file);

    if (!uploadStore.addItem({ id: deviceAssetId, file, albumId })) { // add new item if it not already inside items
      return Promise.resolve<string | undefined>(undefined);
    }

    return queue.push(() =>
      fileUploader({ assetFile: file, deviceAssetId, albumId, isLockedAssets }),
    );
  });

  const assetIds = await Promise.all(uploads);

  return assetIds.filter((assetId): assetId is string => typeof assetId === 'string');
}

/**
 * Uploads one file, updating the store as it goes. Never throws: a failure
 * becomes an `ERROR` item with a message the panel can show.
 */
export async function fileUploader({
  assetFile,
  deviceAssetId,
  isLockedAssets,
}: FileUploaderOptions): Promise<string | undefined> {
  uploadStore.markStarted(deviceAssetId);

  try {
    const formData = new FormData();
    formData.append('fileCreatedAt', new Date(assetFile.lastModified).toISOString());
    formData.append('fileModifiedAt', new Date(assetFile.lastModified).toISOString());
    formData.append('isFavorite', 'false');
    // Re-wrap so the part always carries a filename, which is what the server
    // derives the asset type and storage extension from.
    formData.append('assetData', new File([assetFile], assetFile.name));

    if (isLockedAssets) {
      formData.append('visibility', AssetVisibility.LOCKED);
    }
    console.log('how about this');

    // 1. Hash locally, then ask the server whether it already has these bytes.
    //    A hit means the file never leaves the machine (spec §4.2).
    const checksum = await hashFile(assetFile);
    const [check] = (await checkBulkUpload([{ id: assetFile.name, checksum }])).results;

    if (check?.action === AssetUploadAction.REJECT) {
      uploadStore.updateItem(deviceAssetId, {
        assetId: check.assetId,
        isTrashed: check.isTrashed ?? false,
        state: UploadState.DUPLICATED,
      });

      return undefined;
    }

    // 2. Upload, reporting progress on the way.
    const { data, status } = await uploadRequest<AssetMediaResponse>('/assets', formData, {
      onProgress: ({ loaded, total }) => {
        uploadStore.updateProgress(deviceAssetId, loaded, total);
      },
    });

    if (status !== 200 && status !== 201) {
      throw new Error(`Unexpected upload status ${status}`);
    }

    if (data.status === AssetMediaStatus.DUPLICATE) {
      uploadStore.track('duplicate');
      uploadStore.updateItem(deviceAssetId, {
        assetId: data.id,
        state: UploadState.DUPLICATED,
      });

      return undefined;
    }

    uploadStore.track('success');
    uploadStore.updateItem(deviceAssetId, {
      assetId: data.id,
      progress: 100,
      state: UploadState.DONE,
    });
    scheduleAutoRemoval(deviceAssetId);

    return data.id;
  } catch (error) {
    // An aborted upload means the session ended mid-flight (logout), not a
    // failure the user should be told about (spec §8.5).
    if (isAbortError(error)) {
      return undefined;
    }

    uploadStore.track('error');
    uploadStore.updateItem(deviceAssetId, {
      error: describeError(error),
      state: UploadState.ERROR,
    });

    return undefined;
  }
}

/**
 * Opens the OS file dialog and resolves with the chosen files; an empty array
 * means the dialog was dismissed.
 */
export function openFilePicker({
  multiple = true,
  extensions: accepted = getExtensions(),
}: FilePickerOptions = {}): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;

    if (accepted.length > 0) {
      input.accept = accepted.map((extension) => `.${extension}`).join(',');
    }

    // Safari refuses to open the dialog unless the input is in the document.
    input.style.display = 'none';
    document.body.append(input);

    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      finish(input.files ? [...input.files] : []);
    });

    // Fired when the dialog is dismissed without choosing anything.
    input.addEventListener('cancel', () => {
      finish([]);
    });

    input.click();
  });
}

/** Pick files, then upload them. Returns the ids of newly created assets. */
export async function openFileUploadDialog({
  albumId,
  multiple = true,
}: { albumId?: string; multiple?: boolean } = {}): Promise<string[]> {
  const files = await openFilePicker({ multiple });

  if (files.length === 0) {
    return [];
  }

  return fileUploadHandler({ files, albumId });
}

function deviceAssetIdFor(file: File): string {
  return `web-${file.name}-${file.lastModified}`;
}

function scheduleAutoRemoval(id: string): void {
  setTimeout(() => {
    uploadStore.removeItem(id);
  }, DONE_ITEM_LIFETIME_MS);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
