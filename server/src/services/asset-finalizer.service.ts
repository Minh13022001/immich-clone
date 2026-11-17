import { BadRequestException, Injectable } from '@nestjs/common';

import type { AuthContext } from '../authentication/context';
import { AssetVisibility, type CreateAssetDto } from '../dtos/asset-media.dto';
import { JobName, JobSource } from '../dtos/job.dto';
import { AssetRepository } from '../repositories/asset.repository';
import { EventRepository } from '../repositories/event.repository';
import { ExifRepository } from '../repositories/exif.repository';
import { JobRepository } from '../repositories/job.repository';
import type { StorageBackend } from '../repositories/object-storage.repository';
import type { AssetRow } from '../schema';
import { toAssetResponse } from '../utils/asset-mapper';
import { getAssetType } from '../utils/mime-types';

/** Everything the finalize step needs; the bytes are already stored. */
export interface FinalizeAssetInput {
  auth: AuthContext;
  dto: CreateAssetDto;
  /** Verified whole-file digest; never a value the client simply asserted. */
  checksum: Buffer;
  /** Verified byte count of the stored object. */
  size: number;
  originalFileName: string;
  storageBackend: StorageBackend;
  storageKey: string;
  /**
   * Backend-specific hook that stamps the device mtime onto the stored object.
   * Omitted for object stores, which have no meaningful mtime.
   */
  stampModifiedTime?: (modifiedAt: Date) => Promise<void>;
}

/**
 * Turns "verified bytes exist at `storageKey`" into an asset row.
 *
 * Both upload paths (the legacy multipart `POST /assets` and the new
 * presigned direct upload) end here, so the asset fields, the live-photo link,
 * the EXIF row, the metadata rows, the follow-up job and the SSE event can never
 * drift apart. Callers own the bytes and therefore own their own cleanup; this
 * class only rolls back the row it created.
 */
@Injectable()
export class AssetFinalizerService {
  constructor(
    private readonly assetRepository: AssetRepository,
    private readonly exifRepository: ExifRepository,
    private readonly jobRepository: JobRepository,
    private readonly eventRepository: EventRepository,
  ) {}

  async finalizeAsset(input: FinalizeAssetInput): Promise<AssetRow> {
    const { auth, dto, checksum, size, originalFileName, storageBackend, storageKey } = input;

    const fileCreatedAt = new Date(dto.fileCreatedAt);
    const fileModifiedAt = new Date(dto.fileModifiedAt);

    // Checked before anything is written, so a bad link never leaves an asset.
    if (dto.livePhotoVideoId) {
      await this.assertLivePhotoCounterpart(auth, dto.livePhotoVideoId);
    }

    let asset: AssetRow | undefined;

    try {
      asset = await this.assetRepository.create({
        ownerId: auth.user.id,
        libraryId: null,
        checksum,
        checksumAlgorithm: 'sha1File',
        originalPath: storageKey,
        storageBackend,
        storageKey,
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

      if (input.stampModifiedTime) {
        await input.stampModifiedTime(fileModifiedAt);
      }

      await this.exifRepository.upsert({ assetId: asset.id, fileSizeInByte: size });

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
        file: { path: storageKey, size },
      });

      return asset;
    } catch (error) {
      // A half-written asset is worse than no asset: the caller still owns the
      // bytes, but the row (and the metadata rows cascading off it) must go.
      if (asset) {
        await this.assetRepository.remove(asset.id);
      }

      throw error;
    }
  }

  /** Verifies the live-photo counterpart exists and belongs to the caller. */
  private async assertLivePhotoCounterpart(auth: AuthContext, id: string): Promise<void> {
    const counterpart = await this.assetRepository.getById(id);

    if (!counterpart || counterpart.ownerId !== auth.user.id) {
      throw new BadRequestException(`Live photo asset ${id} was not found`);
    }
  }
}
