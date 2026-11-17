import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The orchestrator (§8.5) with its three collaborators replaced: hashing, the
 * bulk pre-check and the direct uploader. What is left under test is exactly
 * the decision logic the spec pins down — when bytes are sent, what the store
 * is told, and which outcomes stay silent.
 */
vi.mock('$lib/utils/hash-file', () => ({ hashFile: vi.fn() }));
vi.mock('$lib/services/upload.service', () => ({
  cancelAssetUpload: vi.fn(),
  checkBulkUpload: vi.fn(),
  fetchSupportedMediaTypes: vi.fn(),
  finalizeAssetUpload: vi.fn(),
  initiateAssetUpload: vi.fn(),
  presignUploadParts: vi.fn(),
}));
vi.mock('$lib/utils/direct-uploader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/direct-uploader')>();

  return { ...actual, directUpload: vi.fn() };
});

import {
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
  type StorageCapabilities,
} from '@immich/sdk';

import { checkBulkUpload } from '$lib/services/upload.service';
import { UploadState, uploadStore, type UploadItem } from '$lib/stores/upload.store.svelte';
import { directUpload } from '$lib/utils/direct-uploader';
import { hashFile } from '$lib/utils/hash-file';

import {
  fileUploadHandler,
  fileUploader,
  getExtensions,
  isSupportedFile,
  setStorageCapabilities,
  setSupportedMediaTypes,
} from './file-uploader';

const CHECKSUM = 'a'.repeat(40);
const LAST_MODIFIED = 1_700_000_000_000;
const DEVICE_ID = `web-photo.jpg-${LAST_MODIFIED}`;
const CREATED = { status: AssetMediaStatus.CREATED, assetId: 'asset-1', uploadId: 'upload-1' };

function makeFile(name: string, lastModified = LAST_MODIFIED, bytes = 'bytes'): File {
  return new File([bytes], name, { lastModified });
}

/** Puts the item in the store the way `fileUploadHandler` would. */
function seedItem(file: File = makeFile('photo.jpg')): UploadItem {
  uploadStore.addItem({ id: DEVICE_ID, file });

  return currentItem();
}

/** The store is indexed by position; this fails loudly if the item is missing. */
function currentItem(): UploadItem {
  const item = uploadStore.items[0];

  if (item === undefined) {
    throw new Error('No upload item in the store');
  }

  return item;
}

describe('fileUploader', () => {
  beforeEach(() => {
    uploadStore.reset();
    // An empty extension list accepts everything, which is the state before the
    // manager has learned the server's media types.
    setSupportedMediaTypes({ image: [], video: [], sidecar: [] });
    setStorageCapabilities(undefined);

    vi.mocked(hashFile).mockResolvedValue(CHECKSUM);
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [{ id: 'photo.jpg', action: AssetUploadAction.ACCEPT }],
    });
    vi.mocked(directUpload).mockResolvedValue(CREATED);
  });

  afterEach(() => {
    vi.useRealTimers();
    uploadStore.reset();
  });

  it('hashes, pre-checks, uploads and marks the item DONE', async () => {
    const item = seedItem();

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBe('asset-1');
    expect(vi.mocked(hashFile)).toHaveBeenCalledWith(item.file);
    expect(vi.mocked(checkBulkUpload)).toHaveBeenCalledWith([
      { id: 'photo.jpg', checksum: CHECKSUM },
    ]);
    expect(vi.mocked(directUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ file: item.file, checksum: CHECKSUM }),
    );
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.DONE,
      progress: 100,
      assetId: 'asset-1',
    });
    expect(uploadStore.success).toBe(1);
  });

  it('forwards the locked-asset flag and the published storage limits', async () => {
    const item = seedItem();
    const capabilities: StorageCapabilities = {
      backend: 'local',
      maxUploadSize: 1024,
      multipartThreshold: 512,
      partSize: 256,
      multipart: false,
    };

    setStorageCapabilities(capabilities);
    await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID, isLockedAssets: true });

    expect(vi.mocked(directUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ isLockedAssets: true, capabilities }),
    );
  });

  it('feeds transport progress into the store', async () => {
    const item = seedItem();
    let midFlight: UploadItem | undefined;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    vi.mocked(directUpload).mockImplementation(async (options) => {
      vi.advanceTimersByTime(1000);
      options.onProgress?.({ loaded: 512, total: 1024 });
      midFlight = { ...currentItem() };

      return CREATED;
    });

    await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(midFlight).toMatchObject({
      state: UploadState.STARTED,
      progress: 50,
      speed: 512,
      eta: 1,
    });
    expect(uploadStore.items[0]).toMatchObject({ state: UploadState.DONE, progress: 100 });
  });

  it('publishes the phase and the session id while the upload runs', async () => {
    const item = seedItem();
    let midFlight: UploadItem | undefined;

    vi.mocked(directUpload).mockImplementation(async (options) => {
      options.onPhase?.('uploading');
      options.onSession?.('upload-1');
      midFlight = { ...currentItem() };

      return CREATED;
    });

    await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(midFlight).toMatchObject({ phase: 'uploading', uploadId: 'upload-1' });
  });

  it('never sends the bytes when the pre-check already knows the checksum', async () => {
    const item = seedItem();

    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [
        {
          id: 'photo.jpg',
          action: AssetUploadAction.REJECT,
          reason: AssetRejectReason.DUPLICATE,
          assetId: 'existing-9',
          isTrashed: true,
        },
      ],
    });

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(vi.mocked(directUpload)).not.toHaveBeenCalled();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.DUPLICATED,
      assetId: 'existing-9',
      isTrashed: true,
    });
    expect([uploadStore.duplicates, uploadStore.errors]).toEqual([1, 0]);
  });

  it('fails the item when the pre-check rejects for any other reason', async () => {
    const item = seedItem();

    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [
        {
          id: 'photo.jpg',
          action: AssetUploadAction.REJECT,
          reason: AssetRejectReason.UNSUPPORTED_FORMAT,
        },
      ],
    });

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(vi.mocked(directUpload)).not.toHaveBeenCalled();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.ERROR,
      error: 'Unsupported file format',
    });
  });

  it('marks a duplicate reported by the server as DUPLICATED', async () => {
    const item = seedItem();

    vi.mocked(directUpload).mockResolvedValue({
      status: AssetMediaStatus.DUPLICATE,
      assetId: 'existing-1',
    });

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.DUPLICATED,
      assetId: 'existing-1',
    });
    expect([uploadStore.duplicates, uploadStore.success, uploadStore.errors]).toEqual([1, 0, 0]);
  });

  it('records a rejected upload as an ERROR item with the server message', async () => {
    const item = seedItem();

    vi.mocked(directUpload).mockRejectedValue(new Error('Quota has been exceeded!'));

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.ERROR,
      error: 'Quota has been exceeded!',
    });
    expect(uploadStore.errors).toBe(1);
  });

  it('stays silent when the upload was aborted', async () => {
    const item = seedItem();

    vi.mocked(directUpload).mockRejectedValue(new DOMException('Upload aborted', 'AbortError'));

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(currentItem().state).toBe(UploadState.STARTED);
    expect([uploadStore.success, uploadStore.errors]).toEqual([0, 0]);
  });

  it('rejects an empty file before hashing it', async () => {
    const item = seedItem(makeFile('photo.jpg', LAST_MODIFIED, ''));

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(vi.mocked(hashFile)).not.toHaveBeenCalled();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.ERROR,
      error: 'File is empty',
    });
  });

  it('rejects a file above the published maximum before hashing it', async () => {
    const item = seedItem(makeFile('photo.jpg', LAST_MODIFIED, 'too-large'));
    setStorageCapabilities({
      backend: 'local',
      maxUploadSize: 4,
      multipartThreshold: 4,
      partSize: 4,
      multipart: false,
    });

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(vi.mocked(hashFile)).not.toHaveBeenCalled();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.ERROR,
      error: 'Upload exceeds the maximum size of 4 bytes',
    });
  });

  it('removes a finished item after a second', async () => {
    vi.useFakeTimers();
    seedItem();

    const upload = fileUploader({ assetFile: makeFile('photo.jpg'), deviceAssetId: DEVICE_ID });
    await vi.advanceTimersByTimeAsync(0);

    expect(uploadStore.items[0]).toMatchObject({ state: UploadState.DONE, progress: 100 });

    await vi.advanceTimersByTimeAsync(1000);
    await upload;

    expect(uploadStore.items).toHaveLength(0);
  });
});

describe('fileUploadHandler', () => {
  beforeEach(() => {
    uploadStore.reset();
    setSupportedMediaTypes({ image: [], video: [], sidecar: [] });
    setStorageCapabilities(undefined);

    vi.mocked(hashFile).mockResolvedValue(CHECKSUM);
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [{ id: 'photo.jpg', action: AssetUploadAction.ACCEPT }],
    });
    vi.mocked(directUpload).mockResolvedValue(CREATED);
  });

  afterEach(() => {
    uploadStore.reset();
  });

  it('expands the server media types into the extensions the picker filters on', () => {
    setSupportedMediaTypes({
      image: ['image/jpeg', 'image/png'],
      video: ['video/mp4'],
      sidecar: ['application/xml'],
    });

    expect(getExtensions()).toEqual(['jpe', 'jpeg', 'jpg', 'mp4', 'png']);
    expect(isSupportedFile(makeFile('Holiday.JPG'))).toBe(true);
    expect(isSupportedFile(makeFile('clip.mp4'))).toBe(true);
    expect(isSupportedFile(makeFile('notes.txt'))).toBe(false);
  });

  it('skips unsupported files and returns only the ids it created', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSupportedMediaTypes({ image: ['image/jpeg'], video: [], sidecar: [] });

    const ids = await fileUploadHandler({
      files: [makeFile('photo.jpg', 1), makeFile('notes.txt', 2)],
    });

    expect(ids).toEqual(['asset-1']);
    expect(warned).toHaveBeenCalledOnce();
    expect(vi.mocked(directUpload)).toHaveBeenCalledTimes(1);
    expect(uploadStore.items.map((item) => item.file.name)).toEqual(['photo.jpg']);
  });

  it('queues the same file only once even if it is dropped twice', async () => {
    const ids = await fileUploadHandler({
      files: [makeFile('photo.jpg', 1), makeFile('photo.jpg', 1)],
    });

    expect(ids).toEqual(['asset-1']);
    expect(vi.mocked(checkBulkUpload)).toHaveBeenCalledTimes(1);
    expect(uploadStore.total).toBe(1);
  });

  it('leaves duplicates out of the returned ids', async () => {
    vi.mocked(directUpload).mockResolvedValue({
      status: AssetMediaStatus.DUPLICATE,
      assetId: 'existing-1',
    });

    const ids = await fileUploadHandler({ files: [makeFile('photo.jpg', 1)] });

    expect(ids).toEqual([]);
    expect(uploadStore.duplicates).toBe(1);
  });
});
