import { getAssetOriginalUrl, getAssetThumbnailUrl } from '@immich/sdk';

/**
 * Thin, app-shaped wrappers around the SDK's asset read surface.
 *
 * These return URLs, not promises: the bytes are fetched by the browser as part
 * of rendering an `<img>`/`<video>`/anchor, so there is nothing to await here.
 */
export function assetThumbnailUrl(id: string): string {
  return getAssetThumbnailUrl(id);
}

export function assetOriginalUrl(id: string): string {
  return getAssetOriginalUrl(id);
}
