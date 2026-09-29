import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, AuthUser } from '../authentication/context';
import type { MulterFile } from '../authentication/upload-request';
import { ASSET_CHECKSUM_CONSTRAINT } from '../constants';
import {
  AssetFileType,
  AssetMediaStatus,
  AssetRejectReason,
  AssetType,
  AssetUploadAction,
  AssetVisibility,
  UploadFieldName,
  type BulkUploadCheckDto,
  type CreateAssetDto,
} from '../dtos/asset-media.dto';
import { JobName, JobSource } from '../dtos/job.dto';
import type { AssetRepository } from '../repositories/asset.repository';
import type { AssetFileRepository } from '../repositories/asset-file.repository';
import type { EventRepository } from '../repositories/event.repository';
import type { ExifRepository } from '../repositories/exif.repository';
import type { JobRepository } from '../repositories/job.repository';
import type { StorageRepository } from '../repositories/storage.repository';
import type { UserRepository } from '../repositories/user.repository';
import type { AssetRow } from '../schema';
import { toChecksum } from '../utils/checksum';
import type { Env } from '../validation';
import { AssetMediaService } from './asset-media.service';

/**
 * `AssetMediaService` (spec §5.4, §6 and §10).
 *
 * Every collaborator is a hand-built stub: the point of these tests is the
 * service's own decisions — which error it raises, what it persists, and in
 * which order — not the SQL underneath it.
 */
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const COUNTERPART_ID = '33333333-3333-4333-8333-333333333333';
const UUID = 'abcd1234-0000-4000-8000-000000000000';
const CHECKSUM_HEX = '3f1a9c0b7d4e5f60718293a4b5c6d7e8f9012345';
const CHECKSUM = toChecksum(CHECKSUM_HEX);

type UploadAssetResult = { id: string; status: AssetMediaStatus };

function createAuth(user: Partial<AuthUser> = {}): AuthContext {
  return {
    sharedLink: null,
    user: {
      id: USER_ID,
      name: 'Test User',
      email: 'test@example.com',
      quotaSizeInBytes: null,
      quotaUsageInBytes: 0,
      ...user,
    },
  };
}

function createDto(overrides: Partial<CreateAssetDto> = {}): CreateAssetDto {
  return {
    fileCreatedAt: '2024-01-01T00:00:00.000Z',
    fileModifiedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

/** A `MulterFile` as the streaming storage would hand it over (path + checksum). */
function createFile(overrides: Record<string, unknown> = {}, mediaRoot: string): MulterFile {
  return {
    fieldname: UploadFieldName.ASSET_DATA,
    originalname: 'photo.JPG',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 2048,
    destination: '',
    filename: '',
    path: join(mediaRoot, 'upload', USER_ID, 'ab', 'cd', `${UUID}.jpg`),
    uuid: UUID,
    checksum: CHECKSUM,
    ...overrides,
  } as unknown as MulterFile;
}

function createAssetRow(overrides: Partial<AssetRow> = {}): AssetRow {
  const timestamp = new Date('2024-01-01T00:00:00.000Z');

  return {
    id: ASSET_ID,
    ownerId: USER_ID,
    libraryId: null,
    checksum: CHECKSUM,
    checksumAlgorithm: 'sha1File',
    originalPath: `/media/upload/${USER_ID}/ab/cd/${UUID}.jpg`,
    originalFileName: 'photo.JPG',
    fileCreatedAt: timestamp,
    fileModifiedAt: timestamp,
    localDateTime: timestamp,
    type: AssetType.IMAGE,
    isFavorite: false,
    duration: null,
    visibility: AssetVisibility.TIMELINE,
    livePhotoVideoId: null,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

/** Builds a service whose `StorageCore` points at a throwaway media root. */
function createService(mediaRoot: string) {
  const assets = {
    create: vi.fn(),
    getById: vi.fn(),
    getByChecksum: vi.fn(),
    getByChecksums: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    upsertMetadata: vi.fn(),
    getMetadata: vi.fn(),
  };
  const assetFiles = { create: vi.fn(), getByAssetId: vi.fn(), upsert: vi.fn() };
  const exif = { getByAssetId: vi.fn(), upsert: vi.fn() };
  const users = { incrementQuotaUsage: vi.fn() };
  const jobs = { register: vi.fn(), queue: vi.fn(), drain: vi.fn() };
  const storage = {
    setTimes: vi.fn(),
    deleteFiles: vi.fn(),
    size: vi.fn(),
    createReadStream: vi.fn(),
  };
  const events = { emit: vi.fn(), forUser: vi.fn() };

  const env: Env = {
    NODE_ENV: 'test',
    PORT: 2283,
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
    DB_DATABASE_NAME: 'immich',
    CORS_ORIGINS: 'http://localhost:3000',
    MEDIA_ROOT: mediaRoot,
  };
  const config = { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;

  const service = new AssetMediaService(
    config,
    assets as unknown as AssetRepository,
    assetFiles as unknown as AssetFileRepository,
    exif as unknown as ExifRepository,
    users as unknown as UserRepository,
    jobs as unknown as JobRepository,
    storage as unknown as StorageRepository,
    events as unknown as EventRepository,
  );

  return { service, assets, assetFiles, exif, users, jobs, storage, events };
}

describe('AssetMediaService', () => {
  let mediaRoot: string;
  let deps: ReturnType<typeof createService>;
  let service: AssetMediaService;

  beforeEach(() => {
    mediaRoot = mkdtempSync(join(tmpdir(), 'immich-media-'));
    deps = createService(mediaRoot);
    service = deps.service;
    deps.assets.create.mockResolvedValue(createAssetRow());
  });

  afterEach(() => {
    rmSync(mediaRoot, { recursive: true, force: true });
  });

  describe('canUploadFile', () => {
    it('accepts a supported asset extension', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({}, mediaRoot),
        body: createDto(),
      };

      expect(service.canUploadFile(request)).toBe(true);
    });

    it('rejects an unsupported asset extension with the exact message', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({ originalname: 'notes.txt' }, mediaRoot),
        body: createDto(),
      };

      expect(() => service.canUploadFile(request)).toThrowError(
        new BadRequestException('Unsupported file type notes.txt'),
      );
    });

    it('prefers the explicit body filename over the multipart filename', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({ originalname: 'upload.bin' }, mediaRoot),
        body: createDto({ filename: 'holiday.jpg' }),
      };

      expect(service.canUploadFile(request)).toBe(true);
    });

    it('accepts .xmp for the sidecar part and rejects an image there', () => {
      const sidecar = {
        auth: createAuth(),
        fieldName: UploadFieldName.SIDECAR_DATA,
        file: createFile({ originalname: 'meta.xmp' }, mediaRoot),
        body: createDto(),
      };
      const wrong = {
        ...sidecar,
        file: createFile({ originalname: 'meta.jpg' }, mediaRoot),
      };

      expect(service.canUploadFile(sidecar)).toBe(true);
      expect(() => service.canUploadFile(wrong)).toThrowError(
        new BadRequestException('Unsupported file type meta.jpg'),
      );
    });

    it('accepts only images for the profile part', () => {
      const avatar = {
        auth: createAuth(),
        fieldName: UploadFieldName.PROFILE_DATA,
        file: createFile({ originalname: 'avatar.png' }, mediaRoot),
        body: createDto(),
      };
      const video = { ...avatar, file: createFile({ originalname: 'clip.mp4' }, mediaRoot) };

      expect(service.canUploadFile(avatar)).toBe(true);
      expect(() => service.canUploadFile(video)).toThrowError(
        new BadRequestException('Unsupported file type clip.mp4'),
      );
    });

    it('refuses a request without an identity', () => {
      const request = {
        auth: null as unknown as AuthContext,
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({}, mediaRoot),
        body: createDto(),
      };

      expect(() => service.canUploadFile(request)).toThrowError(
        new BadRequestException('Authentication required'),
      );
    });
  });

  describe('getUploadFilename', () => {
    it('joins the generated uuid with the lowercase extension', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({ originalname: 'Holiday.JPG' }, mediaRoot),
        body: createDto(),
      };

      expect(service.getUploadFilename(request)).toBe(`${UUID}.jpg`);
    });

    it('keeps a bare filename extension-less', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({ originalname: 'README' }, mediaRoot),
        body: createDto(),
      };

      expect(service.getUploadFilename(request)).toBe(UUID);
    });

    it('always stores a sidecar as .xmp, whatever it arrived as', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.SIDECAR_DATA,
        file: createFile({ originalname: 'metadata.xml' }, mediaRoot),
        body: createDto(),
      };

      expect(service.getUploadFilename(request)).toBe(`${UUID}.xmp`);
    });
  });

  describe('getUploadFolder', () => {
    it('creates the sharded upload folder for an asset part', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file: createFile({}, mediaRoot),
        body: createDto(),
      };

      const folder = service.getUploadFolder(request);

      expect(folder).toBe(join(mediaRoot, 'upload', USER_ID, 'ab', 'cd'));
      expect(existsSync(folder)).toBe(true);
    });

    it('uses the flat profile folder for a profile part', () => {
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.PROFILE_DATA,
        file: createFile({}, mediaRoot),
        body: createDto(),
      };

      const folder = service.getUploadFolder(request);

      expect(folder).toBe(join(mediaRoot, 'profile', USER_ID));
      expect(existsSync(folder)).toBe(true);
    });
  });

  describe('onUploadError', () => {
    it('queues deletion of the partial file', () => {
      const file = createFile({}, mediaRoot);
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file,
        body: createDto(),
      };

      service.onUploadError(request, file);

      expect(deps.jobs.queue).toHaveBeenCalledWith(JobName.FileDelete, {
        files: [join(mediaRoot, 'upload', USER_ID, 'ab', 'cd', `${UUID}.jpg`)],
      });
    });

    it('does nothing when the storage engine never assigned a uuid', () => {
      const file = createFile({ uuid: undefined }, mediaRoot);
      const request = {
        auth: createAuth(),
        fieldName: UploadFieldName.ASSET_DATA,
        file,
        body: createDto(),
      };

      service.onUploadError(request, file);

      expect(deps.jobs.queue).not.toHaveBeenCalled();
    });
  });

  describe('getUploadAssetIdByChecksum', () => {
    it('returns nothing when the header is absent', async () => {
      await expect(service.getUploadAssetIdByChecksum(createAuth())).resolves.toBeUndefined();
      expect(deps.assets.getByChecksum).not.toHaveBeenCalled();
    });

    it('reports a duplicate for a hex checksum the server already has', async () => {
      deps.assets.getByChecksum.mockResolvedValue(createAssetRow());

      await expect(service.getUploadAssetIdByChecksum(createAuth(), CHECKSUM_HEX)).resolves.toEqual(
        {
          id: ASSET_ID,
          status: AssetMediaStatus.DUPLICATE,
        },
      );
      expect(deps.assets.getByChecksum).toHaveBeenCalledWith(USER_ID, CHECKSUM);
    });

    it('decodes a base64 checksum before looking it up', async () => {
      deps.assets.getByChecksum.mockResolvedValue(createAssetRow());

      await service.getUploadAssetIdByChecksum(createAuth(), CHECKSUM.toString('base64'));

      expect(deps.assets.getByChecksum).toHaveBeenCalledWith(USER_ID, CHECKSUM);
    });

    it('uses the first value when the header arrives repeated', async () => {
      deps.assets.getByChecksum.mockResolvedValue(createAssetRow());

      await service.getUploadAssetIdByChecksum(createAuth(), [CHECKSUM_HEX, 'other']);

      expect(deps.assets.getByChecksum).toHaveBeenCalledWith(USER_ID, CHECKSUM);
    });

    it('returns nothing when the checksum is unknown', async () => {
      deps.assets.getByChecksum.mockResolvedValue(undefined);

      await expect(
        service.getUploadAssetIdByChecksum(createAuth(), CHECKSUM_HEX),
      ).resolves.toBeUndefined();
    });
  });

  describe('bulkUploadCheck', () => {
    const dto: BulkUploadCheckDto = {
      assets: [
        { id: 'client-1', checksum: CHECKSUM_HEX },
        { id: 'client-2', checksum: 'f'.repeat(40) },
      ],
    };

    it('rejects known bytes and accepts unknown ones', async () => {
      deps.assets.getByChecksums.mockResolvedValue([createAssetRow()]);

      await expect(service.bulkUploadCheck(createAuth(), dto)).resolves.toEqual({
        results: [
          {
            id: 'client-1',
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: ASSET_ID,
            isTrashed: false,
          },
          { id: 'client-2', action: AssetUploadAction.ACCEPT },
        ],
      });
    });

    it('flags a duplicate that already sits in the trash', async () => {
      deps.assets.getByChecksums.mockResolvedValue([
        createAssetRow({ deletedAt: new Date('2024-02-01T00:00:00.000Z') }),
      ]);

      const [first] = (await service.bulkUploadCheck(createAuth(), dto)).results;

      expect(first).toMatchObject({ action: AssetUploadAction.REJECT, isTrashed: true });
    });

    it('accepts everything when the server has nothing', async () => {
      deps.assets.getByChecksums.mockResolvedValue([]);

      const { results } = await service.bulkUploadCheck(createAuth(), dto);

      expect(results).toEqual([
        { id: 'client-1', action: AssetUploadAction.ACCEPT },
        { id: 'client-2', action: AssetUploadAction.ACCEPT },
      ]);
    });

    it('matches a base64 checksum from the client against the stored digest', async () => {
      deps.assets.getByChecksums.mockResolvedValue([createAssetRow()]);

      const { results } = await service.bulkUploadCheck(createAuth(), {
        assets: [{ id: 'client-1', checksum: CHECKSUM.toString('base64') }],
      });

      expect(results[0]).toMatchObject({ id: 'client-1', action: AssetUploadAction.REJECT });
    });

    it('handles an empty batch without resolving any checksums', async () => {
      // The repository is the layer that short-circuits an empty checksum list
      // (`getByChecksums` returns `[]` without touching the database), so the
      // service simply sees an empty result set and reports no rejections.
      deps.assets.getByChecksums.mockResolvedValue([]);

      await expect(service.bulkUploadCheck(createAuth(), { assets: [] })).resolves.toEqual({
        results: [],
      });

      expect(deps.assets.getByChecksums).toHaveBeenCalledWith(USER_ID, []);
    });
  });

  describe('uploadAsset', () => {
    let auth: AuthContext;
    let file: MulterFile;

    beforeEach(() => {
      auth = createAuth();
      file = createFile({}, mediaRoot);
    });

    it('persists the asset, bills the quota and returns 201-created semantics', async () => {
      const result: UploadAssetResult = await service.uploadAsset(
        auth,
        createDto({ filename: 'renamed.jpg', isFavorite: true }),
        file,
      );

      expect(result).toEqual({ id: ASSET_ID, status: AssetMediaStatus.CREATED });

      expect(deps.assets.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: USER_ID,
          libraryId: null,
          checksum: CHECKSUM,
          originalPath: file.path,
          originalFileName: 'renamed.jpg',
          type: AssetType.IMAGE,
          isFavorite: true,
          duration: null,
          visibility: AssetVisibility.TIMELINE,
          livePhotoVideoId: null,
        }),
      );

      expect(deps.storage.setTimes).toHaveBeenCalledWith(
        file.path,
        expect.any(Date),
        new Date('2024-01-02T00:00:00.000Z'),
      );
      expect(deps.exif.upsert).toHaveBeenCalledWith({
        assetId: ASSET_ID,
        fileSizeInByte: file.size,
      });
      expect(deps.jobs.queue).toHaveBeenCalledWith(JobName.AssetExtractMetadata, {
        id: ASSET_ID,
        source: JobSource.UPLOAD,
      });
      expect(deps.events.emit).toHaveBeenCalledWith(
        'AssetCreate',
        USER_ID,
        expect.objectContaining({
          asset: expect.objectContaining({ id: ASSET_ID }),
          file: { path: file.path, size: file.size },
        }),
      );
      expect(deps.users.incrementQuotaUsage).toHaveBeenCalledWith(USER_ID, file.size);
    });

    it('writes user metadata when the DTO carries any', async () => {
      await service.uploadAsset(
        auth,
        createDto({ metadata: [{ key: 'city', value: 'Bangkok' }] }),
        file,
      );

      expect(deps.assets.upsertMetadata).toHaveBeenCalledWith(ASSET_ID, [
        { key: 'city', value: 'Bangkok' },
      ]);
    });

    it('stores the sidecar as a Sidecar file and stamps it with fileModifiedAt', async () => {
      const sidecarFile = createFile(
        {
          fieldname: UploadFieldName.SIDECAR_DATA,
          originalname: 'meta.xmp',
          path: join(mediaRoot, 'upload', USER_ID, 'ab', 'cd', `${UUID}.xmp`),
          checksum: undefined,
        },
        mediaRoot,
      );

      await service.uploadAsset(auth, createDto(), file, sidecarFile);

      expect(deps.assetFiles.upsert).toHaveBeenCalledWith({
        assetId: ASSET_ID,
        path: sidecarFile.path,
        type: AssetFileType.SIDECAR,
      });
      expect(deps.storage.setTimes).toHaveBeenCalledWith(
        sidecarFile.path,
        expect.any(Date),
        new Date('2024-01-02T00:00:00.000Z'),
      );
    });

    it('links a live photo to its counterpart and makes the counterpart visible', async () => {
      deps.assets.getById.mockResolvedValue(createAssetRow({ id: COUNTERPART_ID }));

      await service.uploadAsset(auth, createDto({ livePhotoVideoId: COUNTERPART_ID }), file);

      expect(deps.assets.update).toHaveBeenCalledWith(COUNTERPART_ID, {
        livePhotoVideoId: ASSET_ID,
        visibility: AssetVisibility.TIMELINE,
      });
    });

    it('rejects a live photo whose counterpart the caller does not own', async () => {
      deps.assets.getById.mockResolvedValue(createAssetRow({ ownerId: 'someone-else' }));

      await expect(
        service.uploadAsset(auth, createDto({ livePhotoVideoId: COUNTERPART_ID }), file),
      ).rejects.toThrowError(
        new BadRequestException(`Live photo asset ${COUNTERPART_ID} was not found`),
      );
      expect(deps.assets.create).not.toHaveBeenCalled();
    });

    it('rejects an upload that would exceed the quota and deletes the partial file', async () => {
      const limited = createAuth({ quotaSizeInBytes: 100, quotaUsageInBytes: 50 });

      await expect(service.uploadAsset(limited, createDto(), file)).rejects.toThrowError(
        new BadRequestException('Quota has been exceeded!'),
      );

      // Nothing is persisted, and the bytes multer already streamed to disk are
      // queued for deletion (spec §6 invariant: on any failure, no partial files
      // remain).
      expect(deps.assets.create).not.toHaveBeenCalled();
      expect(deps.users.incrementQuotaUsage).not.toHaveBeenCalled();
      expect(deps.jobs.queue).toHaveBeenCalledWith(JobName.FileDelete, {
        files: [file.path, undefined],
      });
    });

    it('allows an upload that fits exactly under the quota', async () => {
      const limited = createAuth({ quotaSizeInBytes: file.size, quotaUsageInBytes: 0 });

      await expect(service.uploadAsset(limited, createDto(), file)).resolves.toMatchObject({
        status: AssetMediaStatus.CREATED,
      });
    });

    it('fails loudly when the interceptor never computed a checksum', async () => {
      await expect(
        service.uploadAsset(auth, createDto(), createFile({ checksum: undefined }, mediaRoot)),
      ).rejects.toThrowError(new InternalServerErrorException('Upload checksum was not computed'));
    });

    it('turns a checksum-constraint violation into a duplicate response', async () => {
      deps.assets.create.mockRejectedValue(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: ASSET_CHECKSUM_CONSTRAINT,
        }),
      );
      deps.assets.getByChecksum.mockResolvedValue(createAssetRow());

      await expect(service.uploadAsset(auth, createDto(), file)).resolves.toEqual({
        id: ASSET_ID,
        status: AssetMediaStatus.DUPLICATE,
      });

      // The losing upload's bytes are thrown away, and no row is rolled back
      // because this request never created one.
      expect(deps.jobs.queue).toHaveBeenCalledWith(JobName.FileDelete, {
        files: [file.path, undefined],
      });
      expect(deps.assets.remove).not.toHaveBeenCalled();
    });

    it('deletes both parts when the duplicate lookup finds nothing', async () => {
      deps.assets.create.mockRejectedValue(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: ASSET_CHECKSUM_CONSTRAINT,
        }),
      );
      deps.assets.getByChecksum.mockResolvedValue(undefined);

      await expect(service.uploadAsset(auth, createDto(), file)).rejects.toThrowError(
        InternalServerErrorException,
      );
    });

    it('rolls back the created row and deletes the files when a later write fails', async () => {
      const failure = new Error('exif write failed');
      deps.exif.upsert.mockRejectedValue(failure);

      await expect(service.uploadAsset(auth, createDto(), file)).rejects.toBe(failure);

      expect(deps.assets.remove).toHaveBeenCalledWith(ASSET_ID);
      expect(deps.jobs.queue).toHaveBeenCalledWith(JobName.FileDelete, {
        files: [file.path, undefined],
      });
      expect(deps.users.incrementQuotaUsage).not.toHaveBeenCalled();
    });
  });

  describe('getAssetMediaFile', () => {
    const ORIGINAL_PATH = `/media/upload/${USER_ID}/ab/cd/${UUID}.jpg`;
    const auth = createAuth();

    it('resolves the stream, mime type, name and size of an owned asset', async () => {
      const stream = Readable.from(['bytes']);
      deps.assets.getById.mockResolvedValue(createAssetRow());
      deps.storage.size.mockResolvedValue(2048);
      deps.storage.createReadStream.mockReturnValue(stream);

      await expect(service.getAssetMediaFile(auth, ASSET_ID)).resolves.toEqual({
        stream,
        mimeType: 'image/jpeg',
        fileName: 'photo.JPG',
        size: 2048,
      });

      expect(deps.storage.size).toHaveBeenCalledWith(ORIGINAL_PATH);
      expect(deps.storage.createReadStream).toHaveBeenCalledWith(ORIGINAL_PATH);
    });

    it('checks the file exists before opening a stream', async () => {
      deps.assets.getById.mockResolvedValue(createAssetRow());
      deps.storage.size.mockResolvedValue(2048);

      await service.getAssetMediaFile(auth, ASSET_ID);

      expect(deps.storage.size.mock.invocationCallOrder[0]).toBeLessThan(
        deps.storage.createReadStream.mock.invocationCallOrder[0],
      );
    });

    it('reports an unknown asset as not found without touching storage', async () => {
      deps.assets.getById.mockResolvedValue(undefined);

      await expect(service.getAssetMediaFile(auth, ASSET_ID)).rejects.toThrowError(
        NotFoundException,
      );

      expect(deps.storage.size).not.toHaveBeenCalled();
      expect(deps.storage.createReadStream).not.toHaveBeenCalled();
    });

    it('hides an asset owned by somebody else behind the same 404', async () => {
      deps.assets.getById.mockResolvedValue(createAssetRow({ ownerId: COUNTERPART_ID }));

      await expect(service.getAssetMediaFile(auth, ASSET_ID)).rejects.toThrowError(
        NotFoundException,
      );

      expect(deps.storage.size).not.toHaveBeenCalled();
    });

    it('reports a missing file as not found instead of opening a stream', async () => {
      deps.assets.getById.mockResolvedValue(createAssetRow());
      deps.storage.size.mockResolvedValue(null);

      await expect(service.getAssetMediaFile(auth, ASSET_ID)).rejects.toThrowError(
        NotFoundException,
      );

      expect(deps.storage.createReadStream).not.toHaveBeenCalled();
    });

    it('refuses to serve a file without an identity', async () => {
      await expect(
        service.getAssetMediaFile({ user: undefined } as unknown as AuthContext, ASSET_ID),
      ).rejects.toThrowError(BadRequestException);
    });
  });
});
