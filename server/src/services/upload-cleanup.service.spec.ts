import { afterEach, describe, expect, it, vi } from 'vitest';

import { UPLOAD_CLEANUP_INTERVAL_MS, UPLOAD_VERIFY_TIMEOUT_MS } from '../constants';
import { JobName } from '../dtos/job.dto';
import type { AssetUploadRepository } from '../repositories/asset-upload.repository';
import type { JobRepository } from '../repositories/job.repository';
import type { ObjectStorageRepository } from '../repositories/object-storage.repository';
import type { UserRepository } from '../repositories/user.repository';
import type { AssetUploadRow } from '../schema';
import { toChecksum } from '../utils/checksum';
import { UploadCleanupService } from './upload-cleanup.service';

/**
 * `UploadCleanupService` (brief §4: abandoned uploads must be cleaned up).
 *
 * The contract worth pinning down is the one that protects live requests: a
 * session may only be reclaimed by whoever wins the atomic claim, and the refund
 * must survive a failing object delete — never the other way round.
 */
const USER_ID = '11111111-1111-4111-8111-111111111111';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const STORAGE_KEY = `${USER_ID}/ab/cd/22222222-2222-4222-8222-222222222222.jpg`;
const RESERVED_BYTES = 2048;

function createRow(overrides: Partial<AssetUploadRow> = {}): AssetUploadRow {
  const timestamp = new Date('2024-01-01T00:00:00.000Z');

  return {
    id: UPLOAD_ID,
    ownerId: USER_ID,
    status: 'pending',
    checksum: toChecksum('3f1a9c0b7d4e5f60718293a4b5c6d7e8f9012345'),
    checksumAlgorithm: 'sha1File',
    declaredSize: RESERVED_BYTES,
    declaredContentType: 'image/jpeg',
    assetId: null,
    bucket: 'immich-clone',
    storageKey: STORAGE_KEY,
    multipartUploadId: null,
    partSize: null,
    parts: [],
    dto: {
      filename: 'photo.jpg',
      originalFileName: 'photo.jpg',
      fileCreatedAt: '2024-01-01T00:00:00.000Z',
      fileModifiedAt: '2024-01-01T00:00:00.000Z',
    },
    reservedBytes: RESERVED_BYTES,
    attempts: 0,
    error: null,
    expiresAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createService() {
  const jobs = { register: vi.fn(), queue: vi.fn(), drain: vi.fn() };
  const uploads = {
    listExpired: vi.fn().mockResolvedValue([]),
    listStuckVerifying: vi.fn().mockResolvedValue([]),
    claimForCleanup: vi.fn(),
    update: vi.fn(),
  };
  const users = { releaseQuota: vi.fn().mockResolvedValue(undefined) };
  const storage = {
    deleteObjects: vi.fn().mockResolvedValue(undefined),
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
  };

  const service = new UploadCleanupService(
    jobs as unknown as JobRepository,
    uploads as unknown as AssetUploadRepository,
    users as unknown as UserRepository,
    storage as unknown as ObjectStorageRepository,
  );

  return { service, jobs, uploads, users, storage };
}

describe('UploadCleanupService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refunds quota and deletes the object of an expired session', async () => {
    const { service, uploads, users, storage } = createService();
    const row = createRow();
    uploads.listExpired.mockResolvedValue([row]);
    uploads.claimForCleanup.mockResolvedValue(row);

    const result = await service.sweep(new Date('2024-01-02T00:00:00.000Z'));

    expect(result).toEqual({ expired: 1, stuck: 0, failed: 0 });
    expect(uploads.listExpired).toHaveBeenCalledWith(new Date('2024-01-02T00:00:00.000Z'));
    expect(uploads.claimForCleanup).toHaveBeenCalledWith(UPLOAD_ID, 'expired', undefined);
    expect(users.releaseQuota).toHaveBeenCalledWith(USER_ID, RESERVED_BYTES);
    expect(storage.deleteObjects).toHaveBeenCalledWith([STORAGE_KEY]);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('aborts a half-finished multipart upload before deleting the object', async () => {
    const { service, uploads, storage } = createService();
    const row = createRow({ status: 'uploading', multipartUploadId: 'mpu-1', partSize: 8_388_608 });
    uploads.listExpired.mockResolvedValue([row]);
    uploads.claimForCleanup.mockResolvedValue(row);

    await service.sweep();

    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(STORAGE_KEY, 'mpu-1');
    expect(storage.abortMultipartUpload.mock.invocationCallOrder[0]).toBeLessThan(
      storage.deleteObjects.mock.invocationCallOrder[0],
    );
  });

  it('reclaims a session stuck in verifying as failed', async () => {
    const { service, uploads, users, storage } = createService();
    const row = createRow({ status: 'verifying' });
    uploads.listStuckVerifying.mockResolvedValue([row]);
    uploads.claimForCleanup.mockResolvedValue(row);

    const now = new Date('2024-01-02T00:00:00.000Z');
    const result = await service.sweep(now);

    expect(result).toEqual({ expired: 0, stuck: 1, failed: 0 });
    expect(uploads.listStuckVerifying).toHaveBeenCalledWith(
      new Date(now.getTime() - UPLOAD_VERIFY_TIMEOUT_MS),
    );
    expect(uploads.claimForCleanup).toHaveBeenCalledWith(
      UPLOAD_ID,
      'failed',
      'Upload verification timed out',
    );
    expect(users.releaseQuota).toHaveBeenCalledWith(USER_ID, RESERVED_BYTES);
    expect(storage.deleteObjects).toHaveBeenCalledWith([STORAGE_KEY]);
  });

  it('touches nothing when a live request claimed the session first', async () => {
    const { service, uploads, users, storage } = createService();
    uploads.listExpired.mockResolvedValue([createRow()]);
    uploads.claimForCleanup.mockResolvedValue(undefined);

    const result = await service.sweep();

    expect(result).toEqual({ expired: 0, stuck: 0, failed: 1 });
    expect(users.releaseQuota).not.toHaveBeenCalled();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(uploads.update).not.toHaveBeenCalled();
  });

  it('keeps the refund when the object cannot be deleted', async () => {
    const { service, uploads, users, storage } = createService();
    const row = createRow();
    uploads.listExpired.mockResolvedValue([row]);
    uploads.claimForCleanup.mockResolvedValue(row);
    storage.deleteObjects.mockRejectedValue(new Error('s3 unavailable'));

    const result = await service.sweep();

    expect(result).toEqual({ expired: 1, stuck: 0, failed: 0 });
    expect(users.releaseQuota).toHaveBeenCalledWith(USER_ID, RESERVED_BYTES);
  });

  it('hands the session back when the refund fails', async () => {
    const { service, uploads, users, storage } = createService();
    const row = createRow();
    uploads.listExpired.mockResolvedValue([row]);
    uploads.claimForCleanup.mockResolvedValue(row);
    users.releaseQuota.mockRejectedValue(new Error('db down'));

    const result = await service.sweep();

    expect(result).toEqual({ expired: 0, stuck: 0, failed: 1 });
    expect(uploads.update).toHaveBeenCalledWith(UPLOAD_ID, { status: 'pending', error: null });
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('runs itself through the job queue on an interval', () => {
    vi.useFakeTimers();
    const { service, jobs } = createService();

    service.onModuleInit();

    const handler = jobs.register.mock.calls[0];
    expect(handler?.[0]).toBe(JobName.UploadCleanup);

    expect(jobs.queue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UPLOAD_CLEANUP_INTERVAL_MS);
    expect(jobs.queue).toHaveBeenCalledWith(JobName.UploadCleanup, {});

    service.onModuleDestroy();
    vi.advanceTimersByTime(UPLOAD_CLEANUP_INTERVAL_MS);
    expect(jobs.queue).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while the previous sweep is still running', async () => {
    const { service, uploads, users } = createService();
    const row = createRow();
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    // Park the first sweep *inside* its first await so the re-entrancy guard is
    // certainly engaged before the second tick arrives.
    uploads.listExpired.mockImplementation(async () => {
      await gate;
      return [row];
    });
    uploads.claimForCleanup.mockResolvedValue(row);

    const first = service.sweep();
    await Promise.resolve();

    const second = await service.sweep();

    expect(second).toEqual({ expired: 0, stuck: 0, failed: 0 });
    expect(uploads.listExpired).toHaveBeenCalledTimes(1);
    expect(uploads.claimForCleanup).not.toHaveBeenCalled();
    expect(users.releaseQuota).not.toHaveBeenCalled();

    openGate();

    await expect(first).resolves.toEqual({ expired: 1, stuck: 0, failed: 0 });
    expect(users.releaseQuota).toHaveBeenCalledWith(USER_ID, RESERVED_BYTES);
  });
});
