import { Injectable } from '@nestjs/common';

import type { AssetFileRow, NewAssetFileRow } from '../schema';
import { DatabaseRepository } from './database.repository';

/**
 * SQL for `asset_file` — the "extra files that belong to an asset" table
 * (currently only the `.xmp` sidecar).
 */
@Injectable()
export class AssetFileRepository {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  create(values: NewAssetFileRow): Promise<AssetFileRow> {
    return this.databaseRepository.db
      .insertInto('asset_file')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getByAssetId(assetId: string): Promise<AssetFileRow[]> {
    return this.databaseRepository.db
      .selectFrom('asset_file')
      .selectAll()
      .where('assetId', '=', assetId)
      .execute();
  }

  /**
   * `(assetId, type)` is treated as the logical key by the reference's
   * `upsertFile`, even though the table has no unique constraint for it, so the
   * update path is a select-then-write.
   */
  async upsert(values: NewAssetFileRow): Promise<AssetFileRow> {
    const existing = await this.databaseRepository.db
      .selectFrom('asset_file')
      .selectAll()
      .where('assetId', '=', values.assetId)
      .where('type', '=', values.type)
      .executeTakeFirst();

    if (!existing) {
      return this.create(values);
    }

    return this.databaseRepository.db
      .updateTable('asset_file')
      .set({ path: values.path })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
