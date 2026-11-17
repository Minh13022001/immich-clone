import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';

import type { AuthContext } from '../authentication/context';
import type { MulterFile, UploadRequest } from '../authentication/upload-request';
import {
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
  UploadFieldName,
  type AssetMediaResponseDto,
  type AssetResponseDto,
  type BulkUploadCheckDto,
  type BulkUploadCheckResponseDto,
  type CreateAssetDto,
} from '../dtos/asset-media.dto';
import { JobName } from '../dtos/job.dto';
import { AssetRepository } from '../repositories/asset.repository';
import { JobRepository } from '../repositories/job.repository';
import { ObjectStorageRepository } from '../repositories/object-storage.repository';
import { StorageRepository } from '../repositories/storage.repository';
import { UserRepository } from '../repositories/user.repository';
import type { AssetRow } from '../schema';
import { toAssetResponse } from '../utils/asset-mapper';
import { decodeChecksum, fromChecksum, isAssetChecksumConstraint } from '../utils/checksum';
import { readEnv } from '../utils/config';
import { clampByteRange, formatContentRange, type ByteRange } from '../utils/http-range';
import { getMimeType, isAssetFile, isProfileFile } from '../utils/mime-types';
import { sanitizeFilename, StorageCore, StorageFolder } from '../utils/storage';
import type { Env } from '../validation';
import { AssetFinalizerService } from './asset-finalizer.service';
import { BaseService } from './base.service';

/**
 * A resolved asset original, ready to be streamed to an HTTP response.
 *
 * Returned by {@link AssetMediaService.getAssetMediaFile}; the controller turns
 * it into a `StreamableFile` and owns nothing but the response headers.
 */
export interface AssetMediaFile {
  stream: Readable;
  mimeType: string;
  fileName: string;
  /** Bytes in this response: the slice length for a partial response. */
  size: number;
  /** Set only for a `206 Partial Content` answer; also drives the status code. */
  contentRange?: string;
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
    private readonly userRepository: UserRepository,
    private readonly jobRepository: JobRepository,
    private readonly storageRepository: StorageRepository,
    private readonly objectStorage: ObjectStorageRepository,
    private readonly finalizer: AssetFinalizerService,
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
      fieldName === UploadFieldName.PROFILE_DATA ? isProfileFile(filename) : isAssetFile(filename);

    if (!supported) {
      throw new BadRequestException(`Unsupported file type ${filename}`);
    }

    return true;
  }

  /** `<uuid><ext>`. */
  getUploadFilename({ auth, file }: UploadRequest): string {
    this.requireUploadAccess(auth);

    const extension = extname(file.originalname).toLowerCase();

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

  /**
   * The authoritative upload sequence and catch block (spec §6).
   *
   * The row-creating half now lives in `AssetFinalizerService`, because the
   * presigned direct upload ends in exactly the same place. What stays here is
   * everything that is specific to a multipart request: the digest the
   * interceptor computed, the quota check against the *streamed* size, and the
   * cleanup of the bytes multer already wrote.
   */
  async uploadAsset(
    auth: AuthContext,
    dto: CreateAssetDto,
    file: MulterFile,
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

    try {
      // Deliberately inside the try: the interceptor has already streamed the
      // bytes to disk, so a quota rejection must run the catch block's
      // `FileDelete` (spec §6 invariant — "on any failure, no partial files
      // remain"). The check still precedes `create`, so nothing is persisted
      // (spec §9.4).
      this.requireQuota(auth, file.size);

      const asset = await this.finalizer.finalizeAsset({
        auth,
        dto,
        checksum,
        size: file.size,
        originalFileName: dto.filename || file.originalname,
        // Multer wrote under `MEDIA_ROOT`, so the row records a local object even
        // when the deployment's default backend is S3. Reads follow the row, not
        // the configuration, so pre-migration assets stay readable.
        storageBackend: 'local',
        storageKey: file.path,
        // Object stores have no meaningful mtime; the local backend does.
        stampModifiedTime: (modifiedAt) =>
          this.storageRepository.setTimes(file.path, new Date(), modifiedAt),
      });

      // Only bill quota once every write and the enqueue have succeeded.
      await this.userRepository.incrementQuotaUsage(auth.user.id, file.size);

      return { id: asset.id, status: AssetMediaStatus.CREATED };
    } catch (error) {
      this.jobRepository.queue(JobName.FileDelete, { files: [file.path] });

      if (isAssetChecksumConstraint(error)) {
        const duplicate = await this.assetRepository.getByChecksum(auth.user.id, checksum);

        if (!duplicate) {
          throw new InternalServerErrorException();
        }

        return { id: duplicate.id, status: AssetMediaStatus.DUPLICATE };
      }

      // Any row this request created has already been removed by the finalizer.
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
   *
   * The size is read before the stream because it doubles as an existence check
   * (the `asset` row can outlive its bytes) and as the response's
   * `Content-Length`. A `range` is only ever a hint: it is clamped to the object
   * and dropped when unsatisfiable, so the caller gets a full `200` rather than
   * a 416.
   */
  async getAssetMediaFile(
    auth: AuthContext,
    assetId: string,
    range?: ByteRange,
  ): Promise<AssetMediaFile> {
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

    const resolved = await this.openOriginal(asset, assetId, range);

    return {
      stream: resolved.stream,
      mimeType: getMimeType(asset.originalFileName),
      fileName: asset.originalFileName,
      size: resolved.size,
      contentRange: resolved.contentRange,
    };
  }

  /**
   * Opens wherever the row says the bytes are.
   *
   * The row — never the configured backend — decides: a legacy multer row has
   * no key and an absolute `originalPath`, while a direct-upload row names an
   * object key that `ObjectStorageRepository` resolves for either backend.
   */
  private async openOriginal(
    asset: AssetRow,
    assetId: string,
    range: ByteRange | undefined,
  ): Promise<{ stream: Readable; size: number; contentRange?: string }> {
    if (asset.storageKey) {
      const head = await this.objectStorage.head(asset.storageKey);

      if (!head) {
        throw new NotFoundException(`Asset ${assetId} has no stored object`);
      }

      const slice = clampByteRange(range, head.size);
      const object = await this.objectStorage.getStream(asset.storageKey, slice);

      return {
        stream: object.stream,
        size: object.size,
        contentRange:
          object.contentRange ??
          (slice
            ? formatContentRange(slice.start, slice.end ?? head.size - 1, head.size)
            : undefined),
      };
    }

    const path = asset.originalPath;
    const total = await this.storageRepository.size(path);

    if (total === null) {
      throw new NotFoundException(`Asset ${assetId} has no file on disk`);
    }

    const slice = clampByteRange(range, total);

    if (!slice) {
      return { stream: this.storageRepository.createReadStream(path), size: total };
    }

    const end = slice.end ?? total - 1;

    return {
      stream: this.storageRepository.createReadStream(path, { start: slice.start, end }),
      size: end - slice.start + 1,
      contentRange: formatContentRange(slice.start, end, total),
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
}
