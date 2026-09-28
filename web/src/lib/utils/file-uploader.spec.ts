import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The orchestrator (§8.5) with its three collaborators replaced: hashing, the
 * bulk pre-check and the transport. What is left under test is exactly the
 * decision logic the spec pins down — when bytes are sent, what the store is
 * told, and which outcomes stay silent.
 */
vi.mock('$lib/utils/hash-file', () => ({ hashFile: vi.fn() }));
vi.mock('$lib/services/upload.service', () => ({
  checkBulkUpload: vi.fn(),
  fetchSupportedMediaTypes: vi.fn(),
}));
vi.mock('$lib/utils/upload-request', () => ({
  uploadRequest: vi.fn(),
  cancelUploadRequests: vi.fn(),
}));

import { AssetMediaStatus, AssetRejectReason, AssetUploadAction } from '@immich/sdk';

import { checkBulkUpload } from '$lib/services/upload.service';
import { UploadState, uploadStore, type UploadItem } from '$lib/stores/upload.store.svelte';
import { hashFile } from '$lib/utils/hash-file';
import { uploadRequest } from '$lib/utils/upload-request';

import {
  fileUploadHandler,
  fileUploader,
  getExtensions,
  isSupportedFile,
  setSupportedMediaTypes,
} from './file-uploader';

const CHECKSUM = 'a'.repeat(40);
const LAST_MODIFIED = 1_700_000_000_000;
const DEVICE_ID = `web-photo.jpg-${LAST_MODIFIED}`;
const CREATED = { data: { id: 'asset-1', status: AssetMediaStatus.CREATED }, status: 201 };

function makeFile(name: string, lastModified = LAST_MODIFIED): File {
  return new File(['bytes'], name, { lastModified });
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

    vi.mocked(hashFile).mockResolvedValue(CHECKSUM);
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [{ id: 'photo.jpg', action: AssetUploadAction.ACCEPT }],
    });
    vi.mocked(uploadRequest).mockResolvedValue(CREATED);
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
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.DONE,
      progress: 100,
      assetId: 'asset-1',
    });
    expect(uploadStore.success).toBe(1);
  });

  it('posts the fields the server reads: dates, favourite flag and a named part', async () => {
    const item = seedItem();

    await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    const [path, formData] = vi.mocked(uploadRequest).mock.calls[0]!;

    expect(path).toBe('/assets');
    expect(formData.get('isFavorite')).toBe('false');
    expect(formData.get('fileCreatedAt')).toBe(new Date(LAST_MODIFIED).toISOString());
    expect(formData.get('fileModifiedAt')).toBe(new Date(LAST_MODIFIED).toISOString());
    expect(formData.get('assetData')).toBeInstanceOf(File);
    expect((formData.get('assetData') as File).name).toBe('photo.jpg');
    // Timeline is the default, so no explicit visibility is sent.
    expect(formData.get('visibility')).toBeNull();
  });

  it('sends LOCKED visibility only for locked assets', async () => {
    const item = seedItem();

    await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID, isLockedAssets: true });

    const [, formData] = vi.mocked(uploadRequest).mock.calls[0]!;
    expect(formData.get('visibility')).toBe('locked');
  });

  it('feeds transport progress into the store', async () => {
    const item = seedItem();
    let midFlight: UploadItem | undefined;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    vi.mocked(uploadRequest).mockImplementation(async (_path, _formData, options) => {
      vi.advanceTimersByTime(1000);
      options?.onProgress?.({ loaded: 512, total: 1024 });
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
    expect(vi.mocked(uploadRequest)).not.toHaveBeenCalled();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.DUPLICATED,
      assetId: 'existing-9',
      isTrashed: true,
    });
    expect(uploadStore.errors).toBe(0);
  });

  it('marks a `200 duplicate` from the server as DUPLICATED', async () => {
    const item = seedItem();

    vi.mocked(uploadRequest).mockResolvedValue({
      data: { id: 'existing-1', status: AssetMediaStatus.DUPLICATE },
      status: 200,
    });

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.DUPLICATED,
      assetId: 'existing-1',
    });
    expect([uploadStore.duplicates, uploadStore.success, uploadStore.errors]).toEqual([1, 0, 0]);
  });

  it('records a rejected request as an ERROR item with the server message', async () => {
    const item = seedItem();

    vi.mocked(uploadRequest).mockRejectedValue(new Error('Quota has been exceeded!'));

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.ERROR,
      error: 'Quota has been exceeded!',
    });
    expect(uploadStore.errors).toBe(1);
  });

  it('treats an unexpected success status as a failure', async () => {
    const item = seedItem();

    vi.mocked(uploadRequest).mockResolvedValue({
      data: { id: 'asset-1', status: AssetMediaStatus.CREATED },
      status: 500,
    });

    await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.ERROR,
      error: 'Unexpected upload status 500',
    });
  });

  it('stays silent when the upload was aborted', async () => {
    const item = seedItem();

    vi.mocked(uploadRequest).mockRejectedValue(new DOMException('Upload aborted', 'AbortError'));

    const result = await fileUploader({ assetFile: item.file, deviceAssetId: DEVICE_ID });

    expect(result).toBeUndefined();
    expect(currentItem().state).toBe(UploadState.STARTED);
    expect([uploadStore.success, uploadStore.errors]).toEqual([0, 0]);
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

    vi.mocked(hashFile).mockResolvedValue(CHECKSUM);
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [{ id: 'photo.jpg', action: AssetUploadAction.ACCEPT }],
    });
    vi.mocked(uploadRequest).mockResolvedValue(CREATED);
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
    expect(vi.mocked(uploadRequest)).toHaveBeenCalledTimes(1);
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
    vi.mocked(uploadRequest).mockResolvedValue({
      data: { id: 'existing-1', status: AssetMediaStatus.DUPLICATE },
      status: 200,
    });

    const ids = await fileUploadHandler({ files: [makeFile('photo.jpg', 1)] });

    expect(ids).toEqual([]);
    expect(uploadStore.duplicates).toBe(1);
  });
});
