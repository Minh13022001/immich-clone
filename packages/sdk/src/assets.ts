import { getBaseUrl, request } from './fetch-client';
import type { BulkUploadCheckItem, BulkUploadCheckResponse, SupportedMediaTypes } from './types';

/**
 * Duplicate pre-check (spec §4.2).
 *
 * The client hashes files locally and asks the server which ones already exist,
 * so bytes that would be rejected never leave the machine.
 */
export function bulkUploadCheck(assets: BulkUploadCheckItem[]): Promise<BulkUploadCheckResponse> {
  return request<BulkUploadCheckResponse>('/assets/bulk-upload-check', {
    method: 'POST',
    body: JSON.stringify({ assets }),
  });
}

/**
 * Mime types the server accepts, grouped for file-picker filters (spec §8.3).
 *
 * Fetched once at startup; the web turns the mime types into the extensions its
 * `<input accept>` and drag-and-drop pre-filter should honour.
 */
export function getSupportedMediaTypes(): Promise<SupportedMediaTypes> {
  return request<SupportedMediaTypes>('/server-info/media-types');
}

/**
 * URL of an asset's display image (spec §5.1 read surface).
 *
 * Returns a plain string rather than fetching, because the callers are `<img>`
 * and `<video>` elements: letting the browser own the request keeps streaming,
 * range requests and caching out of the app. The server currently serves the
 * original for this route; a real thumbnail stage can slot in behind it later.
 */
export function getAssetThumbnailUrl(id: string): string {
  return `${getBaseUrl()}/assets/${encodeURIComponent(id)}/thumbnail`;
}

/**
 * URL of an asset's full-size original, for the detail viewer and downloads.
 *
 * As with {@link getAssetThumbnailUrl} this is a URL, not a request — the
 * browser streams the bytes.
 */
export function getAssetOriginalUrl(id: string): string {
  return `${getBaseUrl()}/assets/${encodeURIComponent(id)}/original`;
}
