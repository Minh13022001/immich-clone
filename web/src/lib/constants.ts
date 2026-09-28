/**
 * Web-side constants.
 *
 * `USER_NAME_MAX_LENGTH` / `USER_EMAIL_MAX_LENGTH` intentionally mirror the
 * server's values. The server remains the authority (it validates every
 * request); the client copy only exists so the inputs can stop the user before
 * a round trip.
 */
export const USER_NAME_MAX_LENGTH = 255;
export const USER_EMAIL_MAX_LENGTH = 320;

/**
 * Mime type → file extensions, mirroring the server's media-type registry.
 *
 * The server publishes the mime types it accepts (`GET /server-info/media-types`,
 * spec §8.3), but a browser filters files by *extension*. This map is the
 * translation layer. The server stays authoritative: it re-validates every
 * upload, so a format added there and forgotten here is still accepted when
 * posted — it just will not show up in the picker's `accept` list.
 */
export const MIME_TYPE_EXTENSIONS: Record<string, string[]> = {
  // Images
  'image/jpeg': ['jpg', 'jpeg', 'jpe'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/tiff': ['tif', 'tiff'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'image/avif': ['avif'],
  'image/bmp': ['bmp'],
  'image/svg+xml': ['svg'],
  'image/jxl': ['jxl'],
  'image/dng': ['dng'],
  'image/x-canon-cr2': ['cr2'],
  'image/x-canon-cr3': ['cr3'],
  'image/x-nikon-nef': ['nef'],
  'image/x-nikon-nrw': ['nrw'],
  'image/x-sony-arw': ['arw'],
  'image/x-olympus-orf': ['orf'],
  'image/x-panasonic-rw2': ['rw2'],
  'image/x-fujifilm-raf': ['raf'],
  'image/x-pentax-pef': ['pef'],
  'image/x-samsung-srw': ['srw'],
  'image/x-sigma-x3f': ['x3f'],
  'image/x-minolta-mrw': ['mrw'],

  // Videos
  'video/mp4': ['mp4'],
  'video/x-m4v': ['m4v'],
  'video/quicktime': ['mov'],
  'video/x-matroska': ['mkv'],
  'video/webm': ['webm'],
  'video/x-msvideo': ['avi'],
  'video/x-ms-wmv': ['wmv'],
  'video/x-flv': ['flv'],
  'video/mpeg': ['mpg', 'mpeg'],
  'video/mp2t': ['m2ts', 'mts', 'ts'],
  'video/3gpp': ['3gp', '3gpp'],
  'video/ogg': ['ogv'],
  'video/dvd': ['vob'],
  'application/mxf': ['mxf'],
};
