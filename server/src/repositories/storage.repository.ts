import { Injectable, Logger } from '@nestjs/common';
import { createReadStream, type ReadStream } from 'node:fs';
import { rm, stat, utimes } from 'node:fs/promises';

/**
 * Filesystem side effects, kept next to the other repositories so services stay
 * free of `fs` imports.
 *
 * Every method is best-effort: a failed `utimes` or a missing file must not fail
 * an upload that has already been persisted.
 */
@Injectable()
export class StorageRepository {
  private readonly logger = new Logger(StorageRepository.name);

  /** Sets access/modify times; the modify time mirrors the client's metadata. */
  async setTimes(path: string, accessedAt: Date, modifiedAt: Date): Promise<void> {
    try {
      await utimes(path, accessedAt, modifiedAt);
    } catch (error) {
      this.logger.warn(
        `Could not set timestamps on ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Deletes the given paths, ignoring `undefined` entries and missing files. */
  async deleteFiles(paths: (string | undefined)[]): Promise<void> {
    await Promise.all(
      paths
        .filter((path): path is string => Boolean(path))
        .map(async (path) => {
          try {
            await rm(path, { force: true });
          } catch (error) {
            this.logger.warn(
              `Could not delete ${path}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
    );
  }

  /** Size in bytes, or `null` when the file is gone. */
  async size(path: string): Promise<number | null> {
    try {
      return (await stat(path)).size;
    } catch {
      return null;
    }
  }

  /**
   * Opens `path` for streaming into an HTTP response.
   *
   * The caller owns the returned stream and must destroy it on client
   * disconnect. A missing file surfaces asynchronously as a stream `error`
   * event, so a caller that owes the client a 404 must check {@link size}
   * first — the asset-serving path does exactly that.
   */
  createReadStream(path: string): ReadStream {
    return createReadStream(path);
  }
}
