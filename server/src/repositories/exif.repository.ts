import { Injectable } from '@nestjs/common';

import type { ExifRow, NewExifRow } from '../schema';
import { DatabaseRepository } from './database.repository';

/**
 * SQL for `exif`. One row per asset (the primary key is `assetId`), so writes
 * are upserts — the upload path and the metadata pipeline may both touch it.
 */
@Injectable()
export class ExifRepository {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  getByAssetId(assetId: string): Promise<ExifRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('exif')
      .selectAll()
      .where('assetId', '=', assetId)
      .executeTakeFirst();
  }

  /**
   * Insert-or-update. `lockedPropertiesBehavior: 'override'` in the reference
   * (§6) means the caller's values win, which is exactly what `doUpdateSet`
   * does here.
   */
  upsert(values: NewExifRow): Promise<ExifRow> {
    return this.databaseRepository.db
      .insertInto('exif')
      .values(values)
      .onConflict((oc) =>
        oc.column('assetId').doUpdateSet((eb) => ({
          fileSizeInByte: eb.ref('excluded.fileSizeInByte'),
          updatedAt: new Date(),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
