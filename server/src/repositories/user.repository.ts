import { Injectable } from '@nestjs/common';

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
}
