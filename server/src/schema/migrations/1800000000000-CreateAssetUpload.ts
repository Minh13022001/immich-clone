import { type Kysely, sql } from 'kysely';

import { ASSET_UPLOAD_ACTIVE_CHECKSUM } from '../../constants';
import type { DB } from '../index';

/**
 * Pending direct-upload sessions.
 *
 * One row per authorised upload, created *before* the bytes exist, closed by
 * `/complete`, `/abort` or the expiry sweeper. `dto` freezes the create-asset
 * payload at initiate time so completion never depends on client input.
 *
 * The partial unique index is the idempotency guarantee: at most one open
 * session per `(ownerId, checksum)`, so a retry (or two tabs) reuse the same
 * session and the same object key instead of writing two objects.
 */
export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('asset_upload')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('ownerId', 'uuid', (column) =>
      column.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (column) => column.notNull().defaultTo('pending'))
    .addColumn('checksum', 'bytea', (column) => column.notNull())
    .addColumn('checksumAlgorithm', 'text', (column) => column.notNull().defaultTo('sha1File'))
    .addColumn('declaredSize', 'bigint', (column) => column.notNull())
    .addColumn('declaredContentType', 'text')
    .addColumn('assetId', 'uuid', (column) => column.references('asset.id').onDelete('set null'))
    .addColumn('bucket', 'text', (column) => column.notNull())
    .addColumn('storageKey', 'text', (column) => column.notNull())
    .addColumn('multipartUploadId', 'text')
    .addColumn('partSize', 'integer')
    .addColumn('parts', 'jsonb', (column) => column.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('dto', 'jsonb', (column) => column.notNull())
    .addColumn('reservedBytes', 'bigint', (column) => column.notNull().defaultTo(0))
    .addColumn('attempts', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('error', 'text')
    .addColumn('expiresAt', 'timestamptz', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updatedAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Raw SQL because a *partial* unique index needs a WHERE clause that the
  // schema builder cannot express.
  await sql`
    CREATE UNIQUE INDEX ${sql.id(ASSET_UPLOAD_ACTIVE_CHECKSUM)}
    ON asset_upload (ownerId, checksum)
    WHERE status IN ('pending', 'uploading', 'verifying')
  `.execute(db);

  await db.schema
    .createIndex('asset_upload_expiry_idx')
    .on('asset_upload')
    .columns(['status', 'expiresAt'])
    .execute();
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('asset_upload').ifExists().cascade().execute();
}
