import {
  bulkUploadCheck,
  getSupportedMediaTypes,
  type BulkUploadCheckItem,
  type BulkUploadCheckResponse,
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
