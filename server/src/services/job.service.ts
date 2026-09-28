import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AssetType, AssetVisibility } from '../dtos/asset-media.dto';
import {
  JobName,
  JobSource,
  type AssetJobPayload,
  type FileDeleteJobPayload,
} from '../dtos/job.dto';
import { AssetRepository } from '../repositories/asset.repository';
import { EventRepository } from '../repositories/event.repository';
import { ExifRepository } from '../repositories/exif.repository';
import { JobRepository } from '../repositories/job.repository';
import { StorageRepository } from '../repositories/storage.repository';
import type { ExifRow } from '../schema';
import { toAssetResponse } from '../utils/asset-mapper';

/**
 * The upload pipeline (brief §7).
 *
 * Handlers are registered once at boot on the in-process `JobRepository`. The
 * important part is the *shape* of the chain, not the work each stage does:
 *
 *   AssetExtractMetadata
 *     └─ (source ∈ {upload, copy}) AssetGenerateThumbnails
 *          ├─ SmartSearch ── (source = upload) AssetDetectDuplicates
 *          ├─ AssetDetectFaces
 *          ├─ Ocr
 *          ├─ AssetEncodeVideo        (videos only)
 *          └─ events                  (visibility ∈ {timeline, archive})
 *
 * EXIF parsing, thumbnailing, ML, OCR and transcoding all need dependencies this
 * clone deliberately does not ship (see `plans/asset-upload-decisions.md`), so
 * those stages are pass-throughs. What is *not* stubbed is the contract the
 * frontend depends on: the ordering above and the two upload events.
 */
@Injectable()
export class JobService implements OnModuleInit {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly assetRepository: AssetRepository,
    private readonly exifRepository: ExifRepository,
    private readonly storageRepository: StorageRepository,
    private readonly eventRepository: EventRepository,
  ) {}

  onModuleInit(): void {
    this.jobRepository.register(JobName.AssetExtractMetadata, (payload) =>
      this.handleExtractMetadata(payload as AssetJobPayload),
    );
    this.jobRepository.register(JobName.AssetGenerateThumbnails, (payload) =>
      this.handleGenerateThumbnails(payload as AssetJobPayload),
    );
    this.jobRepository.register(JobName.SmartSearch, (payload) =>
      this.handleSmartSearch(payload as AssetJobPayload),
    );
    this.jobRepository.register(JobName.AssetDetectFaces, (payload) =>
      this.handleStub(JobName.AssetDetectFaces, payload),
    );
    this.jobRepository.register(JobName.Ocr, (payload) => this.handleStub(JobName.Ocr, payload));
    this.jobRepository.register(JobName.AssetEncodeVideo, (payload) =>
      this.handleStub(JobName.AssetEncodeVideo, payload),
    );
    this.jobRepository.register(JobName.AssetDetectDuplicates, (payload) =>
      this.handleStub(JobName.AssetDetectDuplicates, payload),
    );
    this.jobRepository.register(JobName.FileDelete, (payload) =>
      this.handleFileDelete(payload as FileDeleteJobPayload),
    );
  }

  /**
   * EXIF extraction, then the single advance into thumbnailing.
   *
   * The reference advances through `StorageTemplateMigrationSingle` first; this
   * clone has no storage template, so the advance happens here (D5 divergence,
   * recorded in the decisions file).
   */
  private async handleExtractMetadata(payload: AssetJobPayload): Promise<void> {
    const asset = await this.assetRepository.getById(payload.id);

    if (!asset) {
      this.logger.warn(`AssetExtractMetadata: asset ${payload.id} no longer exists`);
      return;
    }

    // `fileSizeInByte` — the only EXIF column this clone models — is written on
    // the upload path from the streamed size, so there is nothing to extract.
    if (payload.source === JobSource.UPLOAD || payload.source === JobSource.COPY) {
      this.jobRepository.queue(JobName.AssetGenerateThumbnails, payload);
    }
  }

  /** Terminal stage that fans out to the analysis jobs and notifies clients. */
  private async handleGenerateThumbnails(payload: AssetJobPayload): Promise<void> {
    const asset = await this.assetRepository.getById(payload.id);

    if (!asset) {
      this.logger.warn(`AssetGenerateThumbnails: asset ${payload.id} no longer exists`);
      return;
    }

    // Only an upload (or an explicit `notify`) is worth telling the user about;
    // background re-derivations stay silent.
    if (payload.source !== JobSource.UPLOAD && !payload.notify) {
      return;
    }

    const next: AssetJobPayload = { id: asset.id, source: payload.source };

    this.jobRepository.queue(JobName.SmartSearch, next);
    this.jobRepository.queue(JobName.AssetDetectFaces, next);
    this.jobRepository.queue(JobName.Ocr, next);

    if (asset.type === AssetType.VIDEO) {
      this.jobRepository.queue(JobName.AssetEncodeVideo, next);
    }

    if (
      asset.visibility !== AssetVisibility.TIMELINE &&
      asset.visibility !== AssetVisibility.ARCHIVE
    ) {
      return;
    }

    const dto = toAssetResponse(asset);
    this.eventRepository.emit('on_upload_success', asset.ownerId, dto);

    const exif = await this.exifRepository.getByAssetId(asset.id);

    if (exif) {
      this.eventRepository.emit('AssetUploadReadyV2', asset.ownerId, {
        asset: dto,
        exif: this.toExifPayload(exif),
      });
    }
  }

  /** `SmartSearch` is the only analysis job that itself queues more work. */
  private async handleSmartSearch(payload: AssetJobPayload): Promise<void> {
    if (payload.source === JobSource.UPLOAD) {
      this.jobRepository.queue(JobName.AssetDetectDuplicates, payload);
    }
  }

  /** Stage that exists to preserve the pipeline's shape; no side effects. */
  private async handleStub(name: JobName, _payload: unknown): Promise<void> {
    this.logger.debug(`${name} is a no-op in this clone`);
  }

  private async handleFileDelete(payload: FileDeleteJobPayload): Promise<void> {
    await this.storageRepository.deleteFiles(payload.files);
  }

  private toExifPayload(exif: ExifRow): Record<string, unknown> {
    return {
      fileSizeInByte: exif.fileSizeInByte === null ? null : Number(exif.fileSizeInByte),
      createdAt: exif.createdAt.toISOString(),
      updatedAt: exif.updatedAt.toISOString(),
    };
  }
}
