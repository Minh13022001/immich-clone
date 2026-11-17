import { AssetMediaStatus, AssetVisibility, type StorageCapabilities } from '@immich/sdk';

import type { UploadPhase } from '$lib/stores/upload.store.svelte';
import {
  cancelAssetUpload,
  finalizeAssetUpload,
  initiateAssetUpload,
  presignUploadParts,
} from '$lib/services/upload.service';
import { putToPresignedUrl, type UploadProgress } from '$lib/utils/upload-request';

import type {
  AssetUploadCompleteResponse,
  AssetUploadInitiateResponse,
  CompletedAssetUploadPart,
} from '@immich/sdk';

/**
 * One file, direct to the object store (brief §2).
 *
 * The API is only used for the three decisions it owns — what may be uploaded
 * (initiate), which URLs are authorised (parts), and whether the bytes really
 * arrived (complete). The bytes themselves never pass through it.
 *
 * Failure policy: any error after a session exists aborts that session, because
 * the reservation and the partial object are worthless without the asset. The
 * sweeper would clean up eventually; doing it here returns the quota while the
 * user is still looking at the panel.
 */

/** The server caps a single `/parts` call at 100 presigned URLs. */
const PART_BATCH_SIZE = 100;

export interface DirectUploadOptions {
  file: File;
  /** SHA-1 of the whole file, already computed by the caller. */
  checksum: string;
  isLockedAssets?: boolean;
  /** Server-published limits; used to fail fast on a doomed file. */
  capabilities?: StorageCapabilities;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  onPhase?: (phase: UploadPhase) => void;
  /** Told as soon as a session exists, so it can be aborted later. */
  onSession?: (uploadId: string) => void;
}

export interface DirectUploadResult {
  status: AssetMediaStatus;
  /** Set for both outcomes: an existing asset, or the one just created. */
  assetId?: string;
  /** Empty when the server already had the bytes. */
  uploadId?: string;
}

/**
 * Rejects files the server is certain to refuse, before any bytes are hashed.
 *
 * The numbers come from `GET /server-info`, so the client never carries its own
 * copy of the limits and never disagrees with the server about them.
 */
export function assertUploadable(file: File, capabilities?: StorageCapabilities): void {
  if (file.size === 0) {
    throw new Error('File is empty');
  }

  const maxUploadSize = capabilities?.maxUploadSize;

  if (maxUploadSize !== undefined && file.size > maxUploadSize) {
    throw new Error(`Upload exceeds the maximum size of ${maxUploadSize} bytes`);
  }
}

/**
 * Runs the whole direct-upload flow for one file and resolves with the outcome.
 *
 * `status: duplicate` is a success, not a failure: the bytes were already on the
 * server, so nothing was sent and nothing was billed.
 */
export async function directUpload(options: DirectUploadOptions): Promise<DirectUploadResult> {
  const { file } = options;

  assertUploadable(file, options.capabilities);

  options.onPhase?.('initiating');
  const session = await initiateAssetUpload({
    filename: file.name,
    fileSize: file.size,
    // Only declare a type when the browser knows one; the server derives it from
    // the extension otherwise.
    contentType: file.type || undefined,
    checksum: options.checksum,
    fileCreatedAt: new Date(file.lastModified).toISOString(),
    fileModifiedAt: new Date(file.lastModified).toISOString(),
    isFavorite: false,
    visibility: options.isLockedAssets ? AssetVisibility.LOCKED : undefined,
  });

  if (session.status === 'duplicate') {
    return { status: AssetMediaStatus.DUPLICATE, assetId: session.assetId };
  }

  options.onSession?.(session.uploadId);

  try {
    options.onPhase?.('uploading');
    const parts = session.multipart
      ? await uploadMultipart(session, options)
      : await uploadSingle(session, options);

    options.onPhase?.('completing');
    const completed = await finalizeAssetUpload(session.uploadId, parts ? { parts } : {});

    return toResult(completed, session.uploadId);
  } catch (error) {
    await cancelAssetUpload(session.uploadId).catch((abortError: unknown) => {
      // Best effort: a failed abort must never mask the real upload failure.
      console.warn('[upload] Could not abort the upload session', abortError);
    });
    throw error;
  }
}

function toResult(completed: AssetUploadCompleteResponse, uploadId: string): DirectUploadResult {
  return { status: completed.status, assetId: completed.id, uploadId };
}

/** Small files: one presigned PUT of the whole file. */
async function uploadSingle(
  session: AssetUploadInitiateResponse,
  options: DirectUploadOptions,
): Promise<undefined> {
  if (!session.url) {
    throw new Error('Upload session did not include a URL');
  }

  await putToPresignedUrl(session.url, options.file, {
    method: session.method ?? 'PUT',
    headers: session.headers,
    onProgress: options.onProgress,
    signal: options.signal,
  });

  return undefined;
}

/**
 * Large files: presign a batch of parts, upload them in order, collect ETags.
 *
 * Parts are sent sequentially: the per-file queue already allows several files
 * at once, and ordering keeps the progress bar monotonic instead of jumping
 * around between concurrent ranges.
 */
async function uploadMultipart(
  session: AssetUploadInitiateResponse,
  options: DirectUploadOptions,
): Promise<CompletedAssetUploadPart[] | undefined> {
  const { file } = options;
  const partSize = session.partSize;
  const partCount = Math.max(1, session.partCount);
  const completed: CompletedAssetUploadPart[] = [];
  let sent = 0;

  for (let first = 1; first <= partCount; first += PART_BATCH_SIZE) {
    const numbers = partNumbers(first, Math.min(first + PART_BATCH_SIZE - 1, partCount));
    const { parts } = await presignUploadParts(
      session.uploadId,
      numbers.map((partNumber) => ({ partNumber })),
    );
    const presigned = new Map(parts.map((part) => [part.partNumber, part]));

    for (const partNumber of numbers) {
      const part = presigned.get(partNumber);

      if (!part) {
        throw new Error(`The server did not presign part ${partNumber}`);
      }

      const start = (partNumber - 1) * partSize;
      const slice = file.slice(start, Math.min(start + partSize, file.size));
      const offset = sent;

      const result = await putToPresignedUrl(part.url, slice, {
        method: part.method,
        headers: part.headers,
        signal: options.signal,
        onProgress: ({ loaded }) => {
          options.onProgress?.({ loaded: offset + loaded, total: file.size });
        },
      });

      if (result.etag) {
        completed.push({ partNumber, etag: result.etag });
      }

      sent += slice.size;
    }
  }

  // The client list is advisory — the server re-reads `ListParts`. Sending a
  // partial list would look like a mismatch, so omit it unless it is complete.
  return completed.length === partCount ? completed : undefined;
}

function partNumbers(first: number, last: number): number[] {
  const numbers: number[] = [];

  for (let partNumber = first; partNumber <= last; partNumber += 1) {
    numbers.push(partNumber);
  }

  return numbers;
}
