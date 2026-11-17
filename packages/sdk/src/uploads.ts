import { request } from './fetch-client';
import type {
  AssetUploadCompleteResponse,
  AssetUploadInitiateResponse,
  AssetUploadPartRequest,
  AssetUploadPartsResponse,
  CompleteAssetUploadRequest,
  InitiateAssetUploadRequest,
} from './types';

/**
 * Direct-to-storage uploads.
 *
 * The flow is three (or four, for large files) round trips with the API and one
 * long transfer that never touches it:
 *
 * 1. {@link requestAssetUpload} — declare the file, receive a presigned URL (or
 *    learn the bytes already exist and short-circuit).
 * 2. {@link requestUploadParts} — large files only: presign a bounded batch of
 *    part URLs instead of the single whole-object URL.
 * 3. The bytes themselves go straight to the store, not to this client.
 * 4. {@link completeAssetUpload} — ask the server to verify what landed and turn
 *    it into an asset. {@link abortAssetUpload} gives up and refunds instead.
 *
 * The presigned URL is a bearer capability: it is scoped to one object and
 * expires, but anyone holding it can write those bytes. Never log or store it.
 */

/** Step 1 — declare the file and (maybe) receive a single-part upload URL. */
export function requestAssetUpload(
  body: InitiateAssetUploadRequest,
): Promise<AssetUploadInitiateResponse> {
  return request<AssetUploadInitiateResponse>('/assets/uploads', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Step 2 — presign part URLs for a multipart session.
 *
 * Batched because the server caps a request at 100 parts; call this in chunks
 * rather than minting every URL for a multi-gigabyte file at once.
 */
export function requestUploadParts(
  uploadId: string,
  parts: AssetUploadPartRequest[],
): Promise<AssetUploadPartsResponse> {
  return request<AssetUploadPartsResponse>(
    `/assets/uploads/${encodeURIComponent(uploadId)}/parts`,
    {
      method: 'POST',
      body: JSON.stringify({ parts }),
    },
  );
}

/**
 * Step 3 — the bytes are in the store; verify them and create the asset.
 *
 * `status` comes back as `duplicate` when a concurrent upload won the race for
 * the same checksum, which is a success: the bytes are on the server either way.
 */
export function completeAssetUpload(
  uploadId: string,
  body: CompleteAssetUploadRequest = {},
): Promise<AssetUploadCompleteResponse> {
  return request<AssetUploadCompleteResponse>(
    `/assets/uploads/${encodeURIComponent(uploadId)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

/**
 * Give up on a session: abort any multipart upload, drop the stored bytes and
 * release the reserved quota.
 *
 * Safe to call for a session the server already expired — it answers `204`
 * either way, so a client that lost track of time can always clean up.
 */
export function abortAssetUpload(uploadId: string): Promise<void> {
  return request<void>(`/assets/uploads/${encodeURIComponent(uploadId)}/abort`, {
    method: 'POST',
  });
}
