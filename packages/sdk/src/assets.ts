import { request } from './fetch-client';
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
