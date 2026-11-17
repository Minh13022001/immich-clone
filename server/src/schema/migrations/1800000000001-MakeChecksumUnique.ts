import { type Kysely, sql } from 'kysely';

import { ASSET_CHECKSUM_CONSTRAINT } from '../../constants';
import type { DB } from '../index';

/**
 * Restores the authoritative duplicate defence.
 *
 * `1790000000000-CreateAssets` created `ASSET_CHECKSUM_CONSTRAINT` with
 * `.unique()` commented out, so `(ownerId, checksum)` was only an index: two
 * uploads of the same bytes both succeeded and `isAssetChecksumConstraint()`
 * could never fire. Direct-to-S3 uploads make that race much easier to hit, so
 * the index is rebuilt as unique here.
 *
 * Existing duplicates are removed first (keeping the oldest row per group), or
 * the unique index cannot be created.
 */
export async function up(db: Kysely<DB>): Promise<void> {
  await sql`
    DELETE FROM asset a
    USING asset b
    WHERE a."ownerId" = b."ownerId"
      AND a.checksum = b.checksum
      AND (a."createdAt", a.ctid) > (b."createdAt", b.ctid)
  `.execute(db);

  await db.schema.dropIndex(ASSET_CHECKSUM_CONSTRAINT).ifExists().execute();

  await sql`
    CREATE UNIQUE INDEX ${sql.id(ASSET_CHECKSUM_CONSTRAINT)}
    ON asset ("ownerId", checksum)
  `.execute(db);
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropIndex(ASSET_CHECKSUM_CONSTRAINT).ifExists().execute();

  await db.schema
    .createIndex(ASSET_CHECKSUM_CONSTRAINT)
    .on('asset')
    .columns(['ownerId', 'checksum'])
    .execute();
}
