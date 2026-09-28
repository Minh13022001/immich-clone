import { extname } from 'node:path';

import { AssetType } from '../dtos/asset-media.dto';

/**
 * Extension → media-type registry (spec §3.4, §5.4).
 *
 * The server never trusts the browser's `Content-Type` for an upload; it maps
 * the *extension* of the original filename to a mime type and an `AssetType`.
 * This is the single source of truth for `canUploadFile`, `getAssetType` and the
 * `getSupportedMediaTypes` endpoint the web client uses to build its file-picker
 * filter.
 */
interface MediaTypeInfo {
  mimeType: string;
  type: AssetType;
}

const IMAGE = AssetType.IMAGE;
const VIDEO = AssetType.VIDEO;

const MEDIA_TYPES: Record<string, MediaTypeInfo> = {
  // Images
  jpg: { mimeType: 'image/jpeg', type: IMAGE },
  jpeg: { mimeType: 'image/jpeg', type: IMAGE },
  jpe: { mimeType: 'image/jpeg', type: IMAGE },
  png: { mimeType: 'image/png', type: IMAGE },
  gif: { mimeType: 'image/gif', type: IMAGE },
  webp: { mimeType: 'image/webp', type: IMAGE },
  tif: { mimeType: 'image/tiff', type: IMAGE },
  tiff: { mimeType: 'image/tiff', type: IMAGE },
  heic: { mimeType: 'image/heic', type: IMAGE },
  heif: { mimeType: 'image/heif', type: IMAGE },
  avif: { mimeType: 'image/avif', type: IMAGE },
  bmp: { mimeType: 'image/bmp', type: IMAGE },
  svg: { mimeType: 'image/svg+xml', type: IMAGE },
  jxl: { mimeType: 'image/jxl', type: IMAGE },
  dng: { mimeType: 'image/dng', type: IMAGE },
  cr2: { mimeType: 'image/x-canon-cr2', type: IMAGE },
  cr3: { mimeType: 'image/x-canon-cr3', type: IMAGE },
  nef: { mimeType: 'image/x-nikon-nef', type: IMAGE },
  arw: { mimeType: 'image/x-sony-arw', type: IMAGE },
  orf: { mimeType: 'image/x-olympus-orf', type: IMAGE },
  rw2: { mimeType: 'image/x-panasonic-rw2', type: IMAGE },
  raf: { mimeType: 'image/x-fujifilm-raf', type: IMAGE },
  pef: { mimeType: 'image/x-pentax-pef', type: IMAGE },
  srw: { mimeType: 'image/x-samsung-srw', type: IMAGE },
  x3f: { mimeType: 'image/x-sigma-x3f', type: IMAGE },
  mrw: { mimeType: 'image/x-minolta-mrw', type: IMAGE },
  nrw: { mimeType: 'image/x-nikon-nrw', type: IMAGE },

  // Videos
  mp4: { mimeType: 'video/mp4', type: VIDEO },
  m4v: { mimeType: 'video/x-m4v', type: VIDEO },
  mov: { mimeType: 'video/quicktime', type: VIDEO },
  mkv: { mimeType: 'video/x-matroska', type: VIDEO },
  webm: { mimeType: 'video/webm', type: VIDEO },
  avi: { mimeType: 'video/x-msvideo', type: VIDEO },
  wmv: { mimeType: 'video/x-ms-wmv', type: VIDEO },
  flv: { mimeType: 'video/x-flv', type: VIDEO },
  mpg: { mimeType: 'video/mpeg', type: VIDEO },
  mpeg: { mimeType: 'video/mpeg', type: VIDEO },
  m2ts: { mimeType: 'video/mp2t', type: VIDEO },
  mts: { mimeType: 'video/mp2t', type: VIDEO },
  ts: { mimeType: 'video/mp2t', type: VIDEO },
  '3gp': { mimeType: 'video/3gpp', type: VIDEO },
  '3gpp': { mimeType: 'video/3gpp', type: VIDEO },
  ogv: { mimeType: 'video/ogg', type: VIDEO },
  vob: { mimeType: 'video/dvd', type: VIDEO },
  mxf: { mimeType: 'application/mxf', type: VIDEO },
};

const SIDECAR_MIME_TYPE = 'application/xml';

/** Lowercased extension without the dot; `''` when the name has no extension. */
export function getExtension(filename: string): string {
  return extname(filename).slice(1).toLowerCase();
}

/** Media info for a filename, or `undefined` when the extension is unsupported. */
export function getMediaTypeInfo(filename: string): MediaTypeInfo | undefined {
  return MEDIA_TYPES[getExtension(filename)];
}

/** True when the filename has a supported image *or* video extension. */
export function isAssetFile(filename: string): boolean {
  return getMediaTypeInfo(filename) !== undefined;
}

/** True when the filename is an `.xmp` sidecar. */
export function isSidecarFile(filename: string): boolean {
  return getExtension(filename) === 'xmp';
}

/** True when the filename is a supported image (used for profile avatars). */
export function isProfileFile(filename: string): boolean {
  return getMediaTypeInfo(filename)?.type === IMAGE;
}

/** `AssetType` derived from the extension; `OTHER` when unsupported. */
export function getAssetType(filename: string): AssetType {
  return getMediaTypeInfo(filename)?.type ?? AssetType.OTHER;
}

/** Mime type for a supported extension, or `application/octet-stream`. */
export function getMimeType(filename: string): string {
  return getMediaTypeInfo(filename)?.mimeType ?? 'application/octet-stream';
}

/** True when `mimeType` is a supported image or video type. */
export function isSupportedMediaType(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

/** Distinct mime types grouped for `GET /server-info`-style media-type responses. */
export function getSupportedMediaTypes(): {
  image: string[];
  video: string[];
  sidecar: string[];
} {
  const image = new Set<string>();
  const video = new Set<string>();

  for (const info of Object.values(MEDIA_TYPES)) {
    if (info.type === IMAGE) {
      image.add(info.mimeType);
    } else if (info.type === VIDEO) {
      video.add(info.mimeType);
    }
  }

  return {
    image: [...image].sort(),
    video: [...video].sort(),
    sidecar: [SIDECAR_MIME_TYPE],
  };
}
