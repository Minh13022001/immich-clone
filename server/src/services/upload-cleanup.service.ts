import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { UPLOAD_CLEANUP_INTERVAL_MS, UPLOAD_VERIFY_TIMEOUT_MS } from '../constants';
import { JobName } from '../dtos/job.dto';
import { AssetUploadRepository } from '../repositories/asset-upload.repository';
import { JobRepository } from '../repositories/job.repository';
import { ObjectStorageRepository } from '../repositories/object-storage.repository';
import { UserRepository } from '../repositories/user.repository';
import type { AssetUploadRow } from '../schema';

/** What one sweep did, logged only when it did something. */
export interface UploadCleanupResult {
  /** Sessions reclaimed because their deadline passed. */
  expired: number;
  /** Sessions reclaimed because `/complete` never finished. */
  stuck: number;
  /** Sessions whose refund lost the race or failed; nothing was touched. */
  failed: number;
}

/**
 * Reclaims abandoned direct uploads (brief §4 "cleanup abandoned uploads").
 *
 * A direct upload reserves quota at `/initiate` and only releases it at
 * `/complete` or `/abort`. A client that closes the tab between the two leaves
 * an open session, reserved bytes and possibly a half-finished multipart upload
 * behind — which is exactly what this sweep exists to undo.
 *
 * The sweep runs through the same in-process queue as the rest of the pipeline
 * (`JobName.UploadCleanup`), so a tick can never overlap the asset jobs.
 */
@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadCleanupService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly uploadRepository: AssetUploadRepository,
    private readonly userRepository: UserRepository,
    private readonly storage: ObjectStorageRepository,
  ) {}

  onModuleInit(): void {
    this.jobRepository.register(JobName.UploadCleanup, async () => {
      await this.sweep();
    });

    this.timer = setInterval(() => {
      this.jobRepository.queue(JobName.UploadCleanup, {});
    }, UPLOAD_CLEANUP_INTERVAL_MS);

    // A housekeeping timer must never keep the process (or a test run) alive.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One pass over everything that was abandoned.
   *
   * Every candidate is *claimed* first (`active -> terminal` in one UPDATE)
   * because `/complete` and `/abort` race with this sweep: whoever wins the
   * update owns the bytes and the reservation. A sweeper that merely marked
   * rows could refund twice, or delete an object an upload had just committed.
   */
  async sweep(now: Date = new Date()): Promise<UploadCleanupResult> {
    const result: UploadCleanupResult = { expired: 0, stuck: 0, failed: 0 };

    if (this.sweeping) {
      this.logger.debug('Upload cleanup is already running; skipping this tick');
      return result;
    }

    this.sweeping = true;

    try {
      const expired = await this.uploadRepository.listExpired(now);
      const stuck = await this.uploadRepository.listStuckVerifying(
        new Date(now.getTime() - UPLOAD_VERIFY_TIMEOUT_MS),
      );

      for (const row of expired) {
        if (await this.reclaim(row, 'expired')) {
          result.expired += 1;
        } else {
          result.failed += 1;
        }
      }

      for (const row of stuck) {
        if (await this.reclaim(row, 'failed', 'Upload verification timed out')) {
          result.stuck += 1;
        } else {
          result.failed += 1;
        }
      }

      if (result.expired > 0 || result.stuck > 0 || result.failed > 0) {
        this.logger.log(
          `Upload cleanup swept expired=${result.expired} stuck=${result.stuck} failed=${result.failed}`,
        );
      }

      return result;
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Takes ownership of one abandoned session and undoes its side effects.
   *
   * Returns `false` when the claim was lost (a live request finished first) or
   * when the refund failed; both are counted, neither is retried here, because a
   * retry inside the same tick would be a second writer for the same session.
   */
  private async reclaim(
    row: AssetUploadRow,
    status: 'expired' | 'failed',
    error?: string,
  ): Promise<boolean> {
    const claimed = await this.uploadRepository.claimForCleanup(row.id, status, error);

    if (!claimed) {
      return false;
    }

    try {
      await this.userRepository.releaseQuota(claimed.ownerId, claimed.reservedBytes);
    } catch (refundError) {
      this.logger.error(
        `Could not refund ${claimed.reservedBytes} bytes to ${claimed.ownerId} for upload ${claimed.id}: ${
          refundError instanceof Error ? refundError.message : String(refundError)
        }`,
      );

      // Hand the session back so the next tick retries the refund; the partial
      // unique index re-arms with it, which is correct — the bytes are still
      // this user's to complete or abandon.
      await this.uploadRepository.update(claimed.id, { status: row.status, error: null });

      return false;
    }

    await this.discardObject(claimed);

    return true;
  }

  /**
   * Best-effort removal of the bytes, including any half-finished multipart
   * upload.
   *
   * Nothing is thrown: a failure here leaves an orphan object, which is what the
   * bucket's lifecycle rule on the `uploads/` prefix exists for (see
   * `plans/asset-upload-s3-migration.md`). It must never block the refund, which
   * has already happened by now.
   */
  private async discardObject(row: AssetUploadRow): Promise<void> {
    if (row.multipartUploadId) {
      try {
        await this.storage.abortMultipartUpload(row.storageKey, row.multipartUploadId);
      } catch (error) {
        this.logger.warn(
          `Could not abort the multipart upload for ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    try {
      await this.storage.deleteObjects([row.storageKey]);
    } catch (error) {
      this.logger.warn(
        `Could not delete object ${row.storageKey} for ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
