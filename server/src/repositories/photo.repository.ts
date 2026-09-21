import { Injectable } from '@nestjs/common';

import type { NewPhotoRow, PhotoRow, PhotoUpdateRow } from '../schema';
import { DatabaseRepository } from './database.repository';

/**
 * The only SQL for photos.
 *
 * Repositories own queries and return rows; they never decide HTTP semantics.
 * That separation is why a "not found" here is `undefined` rather than a 404.
 */
@Injectable()
export class PhotoRepository {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  create(values: NewPhotoRow): Promise<PhotoRow> {
    return this.databaseRepository.db
      .insertInto('photos')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getById(id: string): Promise<PhotoRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('photos')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Newest first, matching what a gallery view expects. */
  getAll(): Promise<PhotoRow[]> {
    return this.databaseRepository.db
      .selectFrom('photos')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .execute();
  }

  update(id: string, values: PhotoUpdateRow): Promise<PhotoRow | undefined> {
    return this.databaseRepository.db
      .updateTable('photos')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Returns whether a row was actually removed, so the service can 404. */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseRepository.db
      .deleteFrom('photos')
      .where('id', '=', id)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }
}
