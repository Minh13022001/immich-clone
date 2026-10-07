import { Injectable } from '@nestjs/common';

import type {
  AssetMetadataRow,
  AssetRow,
  AssetUpdateRow,
  NewAssetRow,
  NewAssetMetadataRow,
} from '../schema';
import { DatabaseRepository } from './database.repository';

/** One `{ key, value }` metadata pair as accepted by `upsertMetadata`. */
export interface AssetMetadataInput {
  key: string;
  value: string;
}

/**
 * All SQL for `asset` and `asset_metadata`.
 *
 * Duplicate detection is intentionally expressed as two queries — one by decoded
 * checksum, one by a set of checksums — because the *constraint* remains the
 * authority; these lookups are only fast paths.
 */
@Injectable()
export class AssetRepository {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  create(values: NewAssetRow): Promise<AssetRow> {
    return this.databaseRepository.db
      .insertInto('asset')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getById(id: string): Promise<AssetRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('asset')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Every non-trashed asset a user owns, newest capture first (library view). */
  listByOwner(ownerId: string): Promise<AssetRow[]> {
    return this.databaseRepository.db
      .selectFrom('asset')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .where('deletedAt', 'is', null)
      .orderBy('fileCreatedAt', 'desc')
      .execute();
  }

  /** `(ownerId, checksum)` lookup backing the header/bulk fast paths. */
  getByChecksum(ownerId: string, checksum: Buffer): Promise<AssetRow | undefined> {
    return this.databaseRepository.db
      .selectFrom('asset')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .where('checksum', '=', checksum)
      .executeTakeFirst();
  }

  /** Batch form used by `bulkUploadCheck`. */
  getByChecksums(ownerId: string, checksums: Buffer[]): Promise<AssetRow[]> {
    if (checksums.length === 0) {
      return Promise.resolve([]);
    }

    return this.databaseRepository.db
      .selectFrom('asset')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .where('checksum', 'in', checksums)
      .execute();
  }

  update(id: string, values: AssetUpdateRow): Promise<AssetRow | undefined> {
    return this.databaseRepository.db
      .updateTable('asset')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Rollback helper for the upload catch block; cascades to child tables. */
  async remove(id: string): Promise<void> {
    await this.databaseRepository.db.deleteFrom('asset').where('id', '=', id).execute();
  }

  /** Inserts or replaces the metadata rows for an asset. */
  async upsertMetadata(assetId: string, items: AssetMetadataInput[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const values: NewAssetMetadataRow[] = items.map((item) => ({
      assetId,
      key: item.key,
      value: item.value,
    }));

    await this.databaseRepository.db
      .insertInto('asset_metadata')
      .values(values)
      .onConflict((oc) =>
        oc.columns(['assetId', 'key']).doUpdateSet((eb) => ({ value: eb.ref('excluded.value') })),
      )
      .execute();
  }

  getMetadata(assetId: string): Promise<AssetMetadataRow[]> {
    return this.databaseRepository.db
      .selectFrom('asset_metadata')
      .selectAll()
      .where('assetId', '=', assetId)
      .execute();
  }
}
