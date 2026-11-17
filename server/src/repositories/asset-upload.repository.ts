import { Injectable } from '@nestjs/common';

import { ASSET_UPLOAD_ACTIVE_CHECKSUM } from '../constants';
import type { AssetUploadRow, AssetUploadUpdateRow, NewAssetUploadRow } from '../schema';
import type { AssetUploadStatus } from '../schema/tables/asset-upload.table';
import { DatabaseRepository } from './database.repository';

/** Statuses that still own their `(ownerId, checksum)` index entry. */
export const ACTIVE_UPLOAD_STATUSES: AssetUploadStatus[] = ['pending', 'uploading', 'verifying'];

/**
 * True when `error` is a collision on the partial unique index over active
 * sessions. Two concurrent initiates for the same bytes race here; the loser
 * re-reads the winner's session instead of failing the request.
 */
export function isActiveUploadConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === '23505' && candidate.constraint === ASSET_UPLOAD_ACTIVE_CHECKSUM;
}

/**
 * SQL for `asset_upload` — the pending-session table that makes direct uploads
 * idempotent.
 *
 * The important methods are the two state transitions: `claimForVerification`
 * (so two concurrent `/complete` calls cannot both create an asset) and
 * `markTerminal` (so a retried request can read the finished outcome instead of
 * re-running verification).
 */
@Injectable()
export class AssetUploadRepository {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  create(values: NewAssetUploadRow): Promise<AssetUploadRow> {
    return this.databaseRepository.db
      .insertInto('asset_upload')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getById(id: string): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('asset_upload')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Finds a still-open session for the same bytes so a retry or a second tab
   * reuses it instead of allocating a second object key.
   */
  getActiveByChecksum(ownerId: string, checksum: Buffer): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('asset_upload')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .where('checksum', '=', checksum)
      .where('status', 'in', ACTIVE_UPLOAD_STATUSES)
      .executeTakeFirst();
  }

  update(id: string, values: AssetUploadUpdateRow): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .updateTable('asset_upload')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /** `pending`/`uploading` -> `verifying`; returns `undefined` on a lost race. */
  claimForVerification(id: string, ownerId: string): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .updateTable('asset_upload')
      .set((eb) => ({
        status: 'verifying',
        attempts: eb('attempts', '+', 1),
        updatedAt: new Date(),
      }))
      .where('id', '=', id)
      .where('ownerId', '=', ownerId)
      .where('status', 'in', ['pending', 'uploading'])
      .returningAll()
      .executeTakeFirst();
  }

  markCompleted(id: string, assetId: string): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .updateTable('asset_upload')
      .set({ status: 'completed', assetId, error: null, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Terminal state for everything that did not produce a new asset.
   *
   * `duplicate` is separate from the error statuses because the client maps it
   * to a 200 with an asset id, exactly like the legacy `POST /assets` path.
   */
  markTerminal(
    id: string,
    status: Extract<AssetUploadStatus, 'duplicate' | 'aborted' | 'expired' | 'failed'>,
    options: { assetId?: string | null; error?: string | null } = {},
  ): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .updateTable('asset_upload')
      .set({
        status,
        assetId: options.assetId ?? null,
        error: options.error ?? null,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Drops a session that never stored anything.
   *
   * Used only as compensation when initiation fails after the row was inserted
   * but before the client could have uploaded: keeping such a row would block
   * the partial unique index for the next attempt.
   */
  async remove(id: string): Promise<boolean> {
    const result = await this.databaseRepository.db
      .deleteFrom('asset_upload')
      .where('id', '=', id)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  /**
   * Takes an *active* session to a terminal state in a single statement.
   *
   * The `status IN (pending, uploading, verifying)` guard is what makes the
   * sweeper safe next to `/complete` and `/abort`: exactly one of them can win,
   * so the object is deleted and the quota refunded exactly once. `undefined`
   * means somebody else already claimed the session.
   */
  claimForCleanup(
    id: string,
    status: Extract<AssetUploadStatus, 'expired' | 'failed'>,
    error?: string,
  ): Promise<AssetUploadRow | undefined> {
    return this.databaseRepository.db
      .updateTable('asset_upload')
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where('id', '=', id)
      .where('status', 'in', ACTIVE_UPLOAD_STATUSES)
      .returningAll()
      .executeTakeFirst();
  }

  /** Open sessions whose deadline has passed; consumed by the sweeper. */
  listExpired(now: Date, limit = 100): Promise<AssetUploadRow[]> {
    return this.databaseRepository.db
      .selectFrom('asset_upload')
      .selectAll()
      .where('status', 'in', ACTIVE_UPLOAD_STATUSES)
      .where('expiresAt', '<', now)
      .orderBy('expiresAt', 'asc')
      .limit(limit)
      .execute();
  }

  /** Sessions stuck in `verifying` (process crash mid-complete). */
  listStuckVerifying(olderThan: Date, limit = 100): Promise<AssetUploadRow[]> {
    return this.databaseRepository.db
      .selectFrom('asset_upload')
      .selectAll()
      .where('status', '=', 'verifying')
      .where('updatedAt', '<', olderThan)
      .limit(limit)
      .execute();
  }
}
