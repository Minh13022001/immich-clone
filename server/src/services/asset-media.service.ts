import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReadStream } from 'node:fs';
import { extname, join } from 'node:path';

import type { AuthContext } from '../authentication/context';
import type { MulterFile, UploadRequest } from '../authentication/upload-request';
import {
  AssetFileType,
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
  AssetVisibility,
  UploadFieldName,
  type AssetMediaResponseDto,
  type AssetResponseDto,
  type BulkUploadCheckDto,
  type BulkUploadCheckResponseDto,
  type CreateAssetDto,
} from '../dtos/asset-media.dto';
import { JobName, JobSource } from '../dtos/job.dto';
import { AssetFileRepository } from '../repositories/asset-file.repository';
import { AssetRepository } from '../repositories/asset.repository';
import { EventRepository } from '../repositories/event.repository';
import { ExifRepository } from '../repositories/exif.repository';
import { JobRepository } from '../repositories/job.repository';
import { StorageRepository } from '../repositories/storage.repository';
import { UserRepository } from '../repositories/user.repository';
import type { AssetRow } from '../schema';
import { toAssetResponse } from '../utils/asset-mapper';
import { decodeChecksum, fromChecksum, isAssetChecksumConstraint } from '../utils/checksum';
import { readEnv } from '../utils/config';
import {
  getAssetType,
  getMimeType,
  isAssetFile,
  isProfileFile,
  isSidecarFile,
} from '../utils/mime-types';
import { sanitizeFilename, StorageCore, StorageFolder } from '../utils/storage';
import type { Env } from '../validation';
import { BaseService } from './base.service';

/**
 * A resolved asset original, ready to be streamed to an HTTP response.
 *
 * Returned by {@link AssetMediaService.getAssetMediaFile}; the controller turns
 * it into a `StreamableFile` and owns nothing but the response headers.
 */
export interface AssetMediaFile {
  stream: ReadStream;
  mimeType: string;
  fileName: string;
  size: number;
}

/**
 * Everything the upload endpoints need (spec §5.4).
 *
 * The service owns the `uploadAsset` sequence and its catch-block semantics
 * (§6); interceptors only decide *whether* a file may be written, never what is
 * persisted.
 */
@Injectable()
export class AssetMediaService extends BaseService {
  private readonly logger = new Logger(AssetMediaService.name);
  private readonly storage: StorageCore;

  constructor(
    config: ConfigService<Env, true>,
    private readonly assetRepository: AssetRepository,
    private readonly assetFileRepository: AssetFileRepository,
    private readonly exifRepository: ExifRepository,
    private readonly userRepository: UserRepository,
    private readonly jobRepository: JobRepository,
    private readonly storageRepository: StorageRepository,
    private readonly eventRepository: EventRepository,
  ) {
    super();
    this.storage = StorageCore.fromEnv(readEnv(config));
  }

  /**
   * Fast-path duplicate lookup for the `x-immich-checksum` header (§5.2). Returns
   * `undefined` when no checksum was supplied or nothing matches.
   */
  async getUploadAssetIdByChecksum(
    auth: AuthContext,
    checksum?: string | string[],
  ): Promise<AssetMediaResponseDto | undefined> {
    const value = Array.isArray(checksum) ? checksum[0] : checksum;

    if (!value) {
      return undefined;
    }

    const row = await this.assetRepository.getByChecksum(auth.user.id, decodeChecksum(value));

    return row ? { id: row.id, status: AssetMediaStatus.DUPLICATE } : undefined;
  }

  /** Accepts or rejects one file part; throws `400 Unsupported file type <name>`. */
  canUploadFile({ auth, fieldName, file, body }: UploadRequest): true {
    this.requireUploadAccess(auth);

    const filename = body.filename || file.originalname;

    const supported =
      fieldName === UploadFieldName.SIDECAR_DATA
        ? isSidecarFile(filename)
        : fieldName === UploadFieldName.PROFILE_DATA
          ? isProfileFile(filename)
          : isAssetFile(filename);

    if (!supported) {
      throw new BadRequestException(`Unsupported file type ${filename}`);
    }

    return true;
  }

  /** `<uuid><ext>`; sidecars are always `.xmp` regardless of the original name. */
  getUploadFilename({ auth, fieldName, file }: UploadRequest): string {
    this.requireUploadAccess(auth);

    const extension =
      fieldName === UploadFieldName.SIDECAR_DATA
        ? '.xmp'
        : extname(file.originalname).toLowerCase();

    return sanitizeFilename(`${file.uuid}${extension}`);
  }

  /** Creates and returns the destination folder for a file part (§5.5). */
  getUploadFolder(request: UploadRequest): string {
    this.requireUploadAccess(request.auth);
    return this.storage.ensureFolder(this.computeFolder(request));
  }

  /** Cleanup hook for a failed/cancelled part; queues deletion of the partial file. */
  onUploadError(request: UploadRequest, file: MulterFile): void {
    if (!file.uuid) {
      return;
    }

    const folder = this.computeFolder({ ...request, file });
    const filename = this.getUploadFilename({ ...request, file });

    this.jobRepository.queue(JobName.FileDelete, { files: [join(folder, filename)] });
  }

  /** The authoritative upload sequence and catch block (spec §6). */
  async uploadAsset(
    auth: AuthContext,
    dto: CreateAssetDto,
    file: MulterFile,
    sidecarFile?: MulterFile,
  ): Promise<AssetMediaResponseDto> {
    this.requireUploadAccess(auth);

    // The checksum is produced by the streaming interceptor for every `assetData`
    // part, so a missing digest means the pipeline was bypassed. The guard stays
    // outside the try block: it is unreachable in production, and `checksum` is
    // narrowed to `Buffer` for the duplicate lookup in the catch block below.
    const checksum = file.checksum;
    if (!checksum) {
      throw new InternalServerErrorException('Upload checksum was not computed');
    }

    const originalFileName = dto.filename || file.originalname;
    const fileCreatedAt = new Date(dto.fileCreatedAt);
    const fileModifiedAt = new Date(dto.fileModifiedAt);

    let asset: AssetRow | undefined;

    try {
      // Deliberately inside the try: the interceptor has already streamed the
      // bytes to disk, so a quota rejection must run the catch block's
      // `FileDelete` (spec §6 invariant — "on any failure, no partial files
      // remain"). The check still precedes `create`, so nothing is persisted
      // (spec §9.4).
      this.requireQuota(auth, file.size);

      if (dto.livePhotoVideoId) {
        await this.onBeforeLink(auth, dto.livePhotoVideoId);
      }

      asset = await this.assetRepository.create({
        ownerId: auth.user.id,
        libraryId: null,
        checksum,
        checksumAlgorithm: 'sha1File',
        originalPath: file.path,
        originalFileName,
        fileCreatedAt,
        fileModifiedAt,
        localDateTime: fileCreatedAt,
        type: getAssetType(originalFileName),
        isFavorite: dto.isFavorite ?? false,
        duration: dto.duration ?? null,
        visibility: dto.visibility ?? AssetVisibility.TIMELINE,
        livePhotoVideoId: dto.livePhotoVideoId ?? null,
      });

      if (dto.metadata?.length) {
        await this.assetRepository.upsertMetadata(
          asset.id,
          dto.metadata.map((item) => ({ key: item.key, value: item.value })),
        );
      }

      if (sidecarFile) {
        await this.assetFileRepository.upsert({
          assetId: asset.id,
          path: sidecarFile.path,
          type: AssetFileType.SIDECAR,
        });
        await this.storageRepository.setTimes(sidecarFile.path, new Date(), fileModifiedAt);
      }

      await this.storageRepository.setTimes(file.path, new Date(), fileModifiedAt);
      await this.exifRepository.upsert({ assetId: asset.id, fileSizeInByte: file.size });

      // Link the motion counterpart back to the still we just created (§9.6).
      if (dto.livePhotoVideoId) {
        await this.assetRepository.update(dto.livePhotoVideoId, {
          livePhotoVideoId: asset.id,
          visibility: AssetVisibility.TIMELINE,
        });
      }

      this.jobRepository.queue(JobName.AssetExtractMetadata, {
        id: asset.id,
        source: JobSource.UPLOAD,
      });

      // Shared links are out of scope (D3): `auth.sharedLink` is always null.

      this.eventRepository.emit('AssetCreate', auth.user.id, {
        asset: toAssetResponse(asset),
        file: { path: file.path, size: file.size },
      });

      // Only bill quota once every write and the enqueue have succeeded.
      await this.userRepository.incrementQuotaUsage(auth.user.id, file.size);

      return { id: asset.id, status: AssetMediaStatus.CREATED };
    } catch (error) {
      this.jobRepository.queue(JobName.FileDelete, { files: [file.path, sidecarFile?.path] });

      if (isAssetChecksumConstraint(error)) {
        const duplicate = await this.assetRepository.getByChecksum(auth.user.id, checksum);

        if (!duplicate) {
          throw new InternalServerErrorException();
        }

        return { id: duplicate.id, status: AssetMediaStatus.DUPLICATE };
      }

      if (asset) {
        await this.assetRepository.remove(asset.id);
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Upload failed: ${message}`, stack);

      throw error;
    }
  }

  /** Duplicate / unsupported pre-check for a batch of client checksums (§4.2). */
  async bulkUploadCheck(
    auth: AuthContext,
    dto: BulkUploadCheckDto,
  ): Promise<BulkUploadCheckResponseDto> {
    this.requireUploadAccess(auth);

    const decoded = dto.assets.map((item) => decodeChecksum(item.checksum));
    const rows = await this.assetRepository.getByChecksums(auth.user.id, decoded);
    const byChecksum = new Map(rows.map((row) => [fromChecksum(row.checksum), row]));

    return {
      results: dto.assets.map((item) => {
        const found = byChecksum.get(fromChecksum(decodeChecksum(item.checksum)));

        if (!found) {
          return { id: item.id, action: AssetUploadAction.ACCEPT };
        }

        return {
          id: item.id,
          action: AssetUploadAction.REJECT,
          reason: AssetRejectReason.DUPLICATE,
          assetId: found.id,
          isTrashed: found.deletedAt !== null,
        };
      }),
    };
  }

  /**
   * Resolves an asset's stored original for inline viewing.
   *
   * Ownership is enforced: an unknown id and a foreign id both answer `404`
   * rather than `403`, so the endpoint cannot be used to probe which ids exist.
   * The on-disk size is read first because it doubles as an existence check
   * (the `asset` row can outlive its file) and as the response's
   * `Content-Length`.
   */
  async getAssetMediaFile(auth: AuthContext, assetId: string): Promise<AssetMediaFile> {
    if (!auth?.user) {
      throw new BadRequestException('Authentication required');
    }

    const asset = this.assertFound(
      await this.assetRepository.getById(assetId),
      `Asset ${assetId} was not found`,
    );

    if (asset.ownerId !== auth.user.id) {
      throw new NotFoundException(`Asset ${assetId} was not found`);
    }

    const size = await this.storageRepository.size(asset.originalPath);

    if (size === null) {
      throw new NotFoundException(`Asset ${assetId} has no file on disk`);
    }

    return {
      stream: this.storageRepository.createReadStream(asset.originalPath),
      mimeType: getMimeType(asset.originalFileName),
      fileName: asset.originalFileName,
      size,
    };
  }

  /**
   * Every asset the caller owns, newest first, for the library view.
   *
   * The response reuses the same projection the SSE stream sends, so a client
   * can render a fetched asset and a pushed one with one code path.
   */
  async getAssets(auth: AuthContext): Promise<AssetResponseDto[]> {
    this.requireUploadAccess(auth);

    const rows = await this.assetRepository.listByOwner(auth.user.id);

    return rows.map((row) => toAssetResponse(row));
  }

  /** Path for a part without creating anything (used by error cleanup). */
  private computeFolder({ auth, fieldName, file }: UploadRequest): string {
    if (fieldName === UploadFieldName.PROFILE_DATA) {
      return this.storage.getUserFolder(StorageFolder.Profile, auth.user.id);
    }

    return this.storage.getNestedFolder(StorageFolder.Upload, auth.user.id, file.uuid);
  }

  /** Every resolved identity may upload (D2). */
  private requireUploadAccess(auth: AuthContext): void {
    if (!auth?.user) {
      throw new BadRequestException('Authentication required');
    }
  }

  /** Rejects before persisting when the upload would cross the user's ceiling. */
  private requireQuota(auth: AuthContext, size: number): void {
    const { quotaSizeInBytes, quotaUsageInBytes } = auth.user;

    if (quotaSizeInBytes !== null && quotaSizeInBytes < quotaUsageInBytes + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }

  /** Verifies the live-photo counterpart exists and belongs to the caller. */
  private async onBeforeLink(auth: AuthContext, livePhotoVideoId: string): Promise<void> {
    const counterpart = await this.assetRepository.getById(livePhotoVideoId);

    if (!counterpart || counterpart.ownerId !== auth.user.id) {
      throw new BadRequestException(`Live photo asset ${livePhotoVideoId} was not found`);
    }
  }
}
