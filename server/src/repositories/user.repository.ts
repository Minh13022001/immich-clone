import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type { NewUserRow, UserRow, UserUpdateRow } from '../schema';
import { DatabaseRepository } from './database.repository';

/**
 * The only SQL for users.
 *
 * Repositories own queries and return rows; they never decide HTTP semantics.
 * That separation is why a "not found" here is `undefined` rather than a 404,
 * and why a unique-email violation bubbles up as a driver error the service
 * translates.
 */
@Injectable()
export class UserRepository {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  create(values: NewUserRow): Promise<UserRow> {
    return this.databaseRepository.db
      .insertInto('users')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getById(id: string): Promise<UserRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Newest first, matching what a management table expects. */
  getAll(): Promise<UserRow[]> {
    return this.databaseRepository.db
      .selectFrom('users')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .execute();
  }

  update(id: string, values: UserUpdateRow): Promise<UserRow | undefined> {
    return this.databaseRepository.db
      .updateTable('users')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Returns whether a row was actually removed, so the service can 404. */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseRepository.db
      .deleteFrom('users')
      .where('id', '=', id)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  /** Adds `bytes` to the running quota counter after a successful upload. */
  async incrementQuotaUsage(id: string, bytes: number): Promise<void> {
    await this.databaseRepository.db
      .updateTable('users')
      .set((eb) => ({ quotaUsageInBytes: eb('quotaUsageInBytes', '+', bytes) }))
      .where('id', '=', id)
      .execute();
  }

  /**
   * Atomically claims `bytes` of quota for a new upload session.
   *
   * The check and the increment happen in a single statement so two concurrent
   * initiations cannot both pass the ceiling test on the same headroom. Returns
   * `false` when the account is out of space, which the service turns into
   * `413 Payload Too Large` — the same status a synchronously stored upload
   * produced before the migration.
   */
  async reserveQuota(id: string, bytes: number): Promise<boolean> {
    const result = await this.databaseRepository.db
      .updateTable('users')
      .set((eb) => ({ quotaReservedInBytes: eb('quotaReservedInBytes', '+', bytes) }))
      .where('id', '=', id)
      .where(
        sql<boolean>`"quotaSizeInBytes" is null
          or "quotaUsageInBytes" + "quotaReservedInBytes" + ${bytes} <= "quotaSizeInBytes"`,
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  /**
   * Turns a reservation into usage once the object is verified and the asset
   * row exists. `greatest(..., 0)` guards against a session that was already
   * released by the sweeper while completion was still in flight.
   */
  async commitQuota(id: string, bytes: number): Promise<void> {
    await this.databaseRepository.db
      .updateTable('users')
      .set({
        quotaReservedInBytes: sql<number>`greatest("quotaReservedInBytes" - ${bytes}, 0)`,
        quotaUsageInBytes: sql<number>`"quotaUsageInBytes" + ${bytes}`,
      })
      .where('id', '=', id)
      .execute();
  }

  /** Gives back a reservation that will never become usage (abort, expiry, failure). */
  async releaseQuota(id: string, bytes: number): Promise<void> {
    await this.databaseRepository.db
      .updateTable('users')
      .set({ quotaReservedInBytes: sql<number>`greatest("quotaReservedInBytes" - ${bytes}, 0)` })
      .where('id', '=', id)
      .execute();
  }
}
