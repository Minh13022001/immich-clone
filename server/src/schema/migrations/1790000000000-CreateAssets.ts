import { type Kysely, sql } from 'kysely';

import type { DB } from '../index';

/**
 * Creates the asset tables and the quota columns on `users`.
 *
 * - `asset` holds one row per uploaded original. `checksum` is `bytea` because
 *   the reference stores the decoded digest, not the client string.
 * - `ASSET_CHECKSUM_CONSTRAINT` is a *unique* index on `(ownerId, checksum)`. It
 *   is the authoritative duplicate defence: two concurrent uploads of the same
 *   bytes race on this index and the loser is handled as a duplicate. The name
 *   is quoted so Postgres preserves the uppercase spelling the service matches
 *   on when it inspects a `23505` error.
 * - `exif.fileSizeInByte` is `bigint`; `utils/database.ts` parses `int8` as a
 *   number so the upload service can do quota arithmetic without string casts.
 * - `users.quotaSizeInBytes` is nullable ("unlimited"); `quotaUsageInBytes`
 *   starts at 0 and is incremented as uploads land.
 */
export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('quotaSizeInBytes', 'bigint')
    .addColumn('quotaUsageInBytes', 'bigint', (column) => column.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('asset')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('ownerId', 'uuid', (column) =>
      column.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('libraryId', 'uuid')
    .addColumn('checksum', 'bytea', (column) => column.notNull())
    .addColumn('checksumAlgorithm', 'text', (column) => column.notNull().defaultTo('sha1File'))
    .addColumn('originalPath', 'text', (column) => column.notNull())
    .addColumn('originalFileName', 'text', (column) => column.notNull())
    .addColumn('fileCreatedAt', 'timestamptz', (column) => column.notNull())
    .addColumn('fileModifiedAt', 'timestamptz', (column) => column.notNull())
    .addColumn('localDateTime', 'timestamptz', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull())
    .addColumn('isFavorite', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('duration', 'integer')
    .addColumn('visibility', 'text', (column) => column.notNull().defaultTo('timeline'))
    .addColumn('livePhotoVideoId', 'uuid')
    .addColumn('deletedAt', 'timestamptz')
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updatedAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('ASSET_CHECKSUM_CONSTRAINT')
    .on('asset')
    .columns(['ownerId', 'checksum'])
    .unique()
    .execute();

  await db.schema
    .createTable('asset_file')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('assetId', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('path', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('exif')
    .addColumn('assetId', 'uuid', (column) =>
      column.primaryKey().references('asset.id').onDelete('cascade'),
    )
    .addColumn('fileSizeInByte', 'bigint')
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updatedAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('asset_metadata')
    .addColumn('assetId', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('value', 'text', (column) => column.notNull())
    .addPrimaryKeyConstraint('asset_metadata_pkey', ['assetId', 'key'])
    .execute();
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('asset_metadata').ifExists().cascade().execute();
  await db.schema.dropTable('exif').ifExists().cascade().execute();
  await db.schema.dropTable('asset_file').ifExists().cascade().execute();
  await db.schema.dropTable('asset').ifExists().cascade().execute();

  await db.schema
    .alterTable('users')
    .dropColumn('quotaSizeInBytes')
    .dropColumn('quotaUsageInBytes')
    .execute();
}
