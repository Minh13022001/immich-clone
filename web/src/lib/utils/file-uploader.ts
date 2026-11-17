import {
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
  type StorageCapabilities,
} from '@immich/sdk';

import { MIME_TYPE_EXTENSIONS } from '$lib/constants';
import { checkBulkUpload } from '$lib/services/upload.service';
import { uploadStore, UploadState } from '$lib/stores/upload.store.svelte';
import { describeError } from '$lib/utils';
import { assertUploadable, directUpload } from '$lib/utils/direct-uploader';
import { ExecutorQueue } from '$lib/utils/executor-queue';
import { hashFile } from '$lib/utils/hash-file';

/**
 * The upload orchestrator (spec §8.5).
 *
 * One file's journey — hash, pre-check, direct upload, bookkeeping — lives in
 * `fileUploader`; `fileUploadHandler` fans a drop/pick over the queue; the two
 * `open*` helpers are the UI entry points.
 *
 * The bytes never pass through this API any more: `directUpload` asks for a
 * session, PUTs straight to the object store and asks the API to verify. This
 * module only decides *whether* to upload and keeps the store honest.
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

/**
 * Server-published storage limits, learned from `GET /server-info`.
 *
 * Kept here rather than imported from the SDK so the client carries no copy of
 * the numbers: a deployment that raises `maxUploadSize` needs no web rebuild.
 */
let capabilities: StorageCapabilities | undefined;

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

/** Records the storage limits advertised by `GET /server-info`. */
export function setStorageCapabilities(value: StorageCapabilities | undefined): void {
  capabilities = value;
}

export function getStorageCapabilities(): StorageCapabilities | undefined {
  return capabilities;
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
  console.log(supported, 'supported');

  if (supported.length !== files.length) {
    console.warn(`[upload] Ignored ${files.length - supported.length} unsupported file(s)`);
  }

  const uploads = supported.map((file) => {
    const deviceAssetId = deviceAssetIdFor(file);

    console.log(deviceAssetId, 'deviceAssetId 33333');

    if (!uploadStore.addItem({ id: deviceAssetId, file, albumId })) { // return if the item is already added
      return Promise.resolve<string | undefined>(undefined);
    }

    console.log(1111111111111);
    return queue.push(() => {  // this only push the callback, not execute fileUploader(...) immediately. only when the callback is called, then fileUploader(...) will be executed
      console.log('queue.push', 1234456);
      return fileUploader({ assetFile: file, deviceAssetId, albumId, isLockedAssets });
    });
    
  });
  console.log(uploads, 'uploads');

  const assetIds = await Promise.all(uploads); //we have await here to gets: the actual array after all Promises fulfill.
  console.log(assetIds, "assetIds");

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
    // Fail fast on files the server is certain to refuse, before spending time
    // hashing them.
    assertUploadable(assetFile, capabilities);

    // 1. Hash locally, then ask the server whether it already has these bytes.
    //    A hit means the file never leaves the machine (spec §4.2).
    uploadStore.updateItem(deviceAssetId, { phase: 'hashing' });
    const checksum = await hashFile(assetFile);
    const [check] = (await checkBulkUpload([{ id: assetFile.name, checksum }])).results;

    if (check?.action === AssetUploadAction.REJECT) {
      if (check.reason === AssetRejectReason.DUPLICATE) {
        uploadStore.track('duplicate');
        uploadStore.updateItem(deviceAssetId, {
          assetId: check.assetId,
          isTrashed: check.isTrashed ?? false,
          state: UploadState.DUPLICATED,
        });

        return undefined;
      }

      // Any other rejection (unsupported format, quarantined, …) is a hard no.
      throw new Error('Unsupported file format');
    }

    // 2. Upload straight to storage, reporting phase and progress on the way.
    const result = await directUpload({
      file: assetFile,
      checksum,
      isLockedAssets,
      capabilities,
      onPhase: (phase) => uploadStore.updateItem(deviceAssetId, { phase }),
      onSession: (uploadId) => uploadStore.updateItem(deviceAssetId, { uploadId }),
      onProgress: ({ loaded, total }) => uploadStore.updateProgress(deviceAssetId, loaded, total),
    });

    if (result.status === AssetMediaStatus.DUPLICATE) {
      uploadStore.track('duplicate');
      uploadStore.updateItem(deviceAssetId, {
        assetId: result.assetId,
        state: UploadState.DUPLICATED,
      });

      return undefined;
    }

    uploadStore.track('success');
    uploadStore.updateItem(deviceAssetId, {
      assetId: result.assetId,
      progress: 100,
      state: UploadState.DONE,
    });
    scheduleAutoRemoval(deviceAssetId);

    return result.assetId;
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
