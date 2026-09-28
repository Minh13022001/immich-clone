import { describe, expect, it } from 'vitest';

import { AssetType } from '../dtos/asset-media.dto';
import {
  getAssetType,
  getExtension,
  getMediaTypeInfo,
  getMimeType,
  getSupportedMediaTypes,
  isAssetFile,
  isProfileFile,
  isSidecarFile,
  isSupportedMediaType,
} from './mime-types';

/**
 * Media-type registry (spec §10 "server unit tests").
 *
 * The registry is the single source of truth for `canUploadFile`, the file
 * picker's `accept` list and `GET /server-info/media-types`, so its accept/reject
 * behaviour is asserted directly rather than through the service.
 */
describe('getExtension', () => {
  it('lowercases the extension and drops the dot', () => {
    expect(getExtension('Holiday.JPG')).toBe('jpg');
  });

  it('returns an empty string when there is no extension', () => {
    expect(getExtension('README')).toBe('');
  });

  it('only considers the last dot', () => {
    expect(getExtension('my.photo.final.png')).toBe('png');
  });
});

describe('isAssetFile', () => {
  it('accepts images and videos', () => {
    expect(isAssetFile('photo.jpg')).toBe(true);
    expect(isAssetFile('clip.mp4')).toBe(true);
  });

  it('rejects sidecars and unknown extensions', () => {
    expect(isAssetFile('photo.xmp')).toBe(false);
    expect(isAssetFile('notes.txt')).toBe(false);
  });
});

describe('isSidecarFile', () => {
  it('only accepts .xmp', () => {
    expect(isSidecarFile('meta.xmp')).toBe(true);
    expect(isSidecarFile('META.XMP')).toBe(true);
    expect(isSidecarFile('meta.xml')).toBe(false);
  });
});

describe('isProfileFile', () => {
  it('accepts images only (a video is not an avatar)', () => {
    expect(isProfileFile('avatar.png')).toBe(true);
    expect(isProfileFile('clip.mp4')).toBe(false);
  });
});

describe('getAssetType / getMimeType', () => {
  it('maps an image extension to IMAGE and its mime type', () => {
    expect(getAssetType('photo.webp')).toBe(AssetType.IMAGE);
    expect(getMimeType('photo.webp')).toBe('image/webp');
  });

  it('maps a video extension to VIDEO', () => {
    expect(getAssetType('clip.mov')).toBe(AssetType.VIDEO);
    expect(getMimeType('clip.mov')).toBe('video/quicktime');
  });

  it('falls back for an unsupported extension', () => {
    expect(getAssetType('notes.txt')).toBe(AssetType.OTHER);
    expect(getMimeType('notes.txt')).toBe('application/octet-stream');
    expect(getMediaTypeInfo('notes.txt')).toBeUndefined();
  });
});

describe('isSupportedMediaType', () => {
  it('accepts image/ and video/ prefixes only', () => {
    expect(isSupportedMediaType('image/jpeg')).toBe(true);
    expect(isSupportedMediaType('video/mp4')).toBe(true);
    expect(isSupportedMediaType('application/xml')).toBe(false);
  });
});

describe('getSupportedMediaTypes', () => {
  it('groups distinct mime types and always advertises the sidecar type', () => {
    const mediaTypes = getSupportedMediaTypes();

    expect(mediaTypes.image).toContain('image/jpeg');
    expect(mediaTypes.image).toContain('image/png');
    expect(mediaTypes.video).toContain('video/mp4');
    expect(mediaTypes.video).toContain('video/quicktime');
    expect(mediaTypes.sidecar).toEqual(['application/xml']);
  });

  it('does not repeat a mime type shared by several extensions', () => {
    const { image } = getSupportedMediaTypes();

    expect(image.filter((mimeType) => mimeType === 'image/jpeg')).toHaveLength(1);
  });
});
