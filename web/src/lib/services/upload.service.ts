import {
  abortAssetUpload,
  bulkUploadCheck,
  completeAssetUpload,
  getSupportedMediaTypes,
  requestAssetUpload,
  requestUploadParts,
  type AssetUploadCompleteResponse,
  type AssetUploadInitiateResponse,
  type AssetUploadPartRequest,
  type AssetUploadPartsResponse,
  type BulkUploadCheckItem,
  type BulkUploadCheckResponse,
  type CompleteAssetUploadRequest,
  type InitiateAssetUploadRequest,
  type SupportedMediaTypes,
} from '@immich/sdk';

/**
 * Thin, app-shaped wrappers around the SDK (the same rule as the other
 * services): the uploader never imports the SDK directly.
 */

/** Asks the server which of the client's checksums it already has (§4.2). */
export function checkBulkUpload(assets: BulkUploadCheckItem[]): Promise<BulkUploadCheckResponse> {
  return bulkUploadCheck(assets);
}

/** Mime types the server accepts, so the picker can filter (§8.3). */
export function fetchSupportedMediaTypes(): Promise<SupportedMediaTypes> {
  return getSupportedMediaTypes();
}

/**
 * Direct-upload step 1 — declare the file and receive a presigned URL.
 *
 * A `duplicate` verdict is a success: the bytes are already stored, so there is
 * nothing to send and nothing to bill.
 */
export function initiateAssetUpload(
  body: InitiateAssetUploadRequest,
): Promise<AssetUploadInitiateResponse> {
  return requestAssetUpload(body);
}

/** Direct-upload step 2 — presign part URLs for a multipart session. */
export function presignUploadParts(
  uploadId: string,
  parts: AssetUploadPartRequest[],
): Promise<AssetUploadPartsResponse> {
  return requestUploadParts(uploadId, parts);
}

/** Direct-upload step 3 — the bytes landed; verify them and create the asset. */
export function finalizeAssetUpload(
  uploadId: string,
  body?: CompleteAssetUploadRequest,
): Promise<AssetUploadCompleteResponse> {
  return completeAssetUpload(uploadId, body);
}

/** Gives up on a session: drops the bytes and releases the reserved quota. */
export function cancelAssetUpload(uploadId: string): Promise<void> {
  return abortAssetUpload(uploadId);
}
