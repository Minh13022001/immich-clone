import { Injectable, Logger } from '@nestjs/common';

import type { JobName } from '../dtos/job.dto';

/** A job handler; `payload` is narrowed by the registering service. */
export type JobHandler = (payload: unknown) => Promise<void>;

/**
 * In-process job queue (adaptation of the reference's BullMQ, see
 * `plans/asset-upload-decisions.md` D5).
 *
 * Jobs run **serially** on a promise chain, which preserves the ordering the
 * upload pipeline depends on (`AssetExtractMetadata` must finish before
 * `AssetGenerateThumbnails`) and bounds memory the way a single worker would.
 * `queue` never rejects into the caller: an upload response must not fail because
 * a background job threw (spec §11 "resilience").
 */
@Injectable()
export class JobRepository {
  private readonly logger = new Logger(JobRepository.name);
  private readonly handlers = new Map<JobName, JobHandler>();
  private chain: Promise<void> = Promise.resolve();

  /** Binds a handler to a job name. Called once per name at boot. */
  register(name: JobName, handler: JobHandler): void {
    if (this.handlers.has(name)) {
      throw new Error(`A handler is already registered for job ${name}`);
    }

    this.handlers.set(name, handler);
  }

  /** Fire-and-forget enqueue; errors are logged, never propagated. */
  queue<T>(name: JobName, payload: T): void {
    this.chain = this.chain.then(() => this.run(name, payload));
  }

  /** Resolves once every job queued so far has settled (used by tests/shutdown). */
  async drain(): Promise<void> {
    await this.chain;
  }

  private async run<T>(name: JobName, payload: T): Promise<void> {
    const handler = this.handlers.get(name);

    if (!handler) {
      this.logger.warn(`No handler registered for job ${name}; payload dropped`);
      return;
    }

    try {
      await handler(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Job ${name} failed: ${message}`, stack);
    }
  }
}
