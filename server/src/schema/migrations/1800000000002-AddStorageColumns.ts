import { type Kysely, sql } from 'kysely';

import type { DB } from '../index';

/**
 * Where the bytes live, per asset, plus the reservation counter that keeps the
 * quota honest while an upload is still in flight.
 *
 * `storageKey` is `NULL` for rows written by the pre-S3 multer path; their
 * locator stays in `originalPath`. New rows always set both, and readers resolve
 * through `storageBackend` (see `AssetMediaService#getAssetMediaFile`).
 */
export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .alterTable('asset')
    .addColumn('storageBackend', 'text', (column) => column.notNull().defaultTo('local'))
    .addColumn('storageKey', 'text')
    .execute();

  await db.schema
    .alterTable('asset_file')
    .addColumn('storageBackend', 'text', (column) => column.notNull().defaultTo('local'))
    .addColumn('storageKey', 'text')
    .execute();

  await db.schema
    .alterTable('users')
    .addColumn('quotaReservedInBytes', 'bigint', (column) => column.notNull().defaultTo(0))
    .execute();

  // Reserve a little headroom: a reserved byte is billed on completion, so
  // usage + reserved must fit inside the limit at authorisation time.
  await sql`
    UPDATE users
    SET "quotaReservedInBytes" = 0
    WHERE "quotaReservedInBytes" <> 0
  `.execute(db);
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('quotaReservedInBytes').execute();

  await db.schema
    .alterTable('asset_file')
    .dropColumn('storageKey')
    .dropColumn('storageBackend')
    .execute();

  await db.schema
    .alterTable('asset')
    .dropColumn('storageKey')
    .dropColumn('storageBackend')
    .execute();
}
