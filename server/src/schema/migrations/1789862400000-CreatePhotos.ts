import { type Kysely, sql } from 'kysely';

import type { DB } from '../index';

/**
 * Creates the `photos` table — the only table in this clone.
 *
 * `gen_random_uuid()` is available without extra extensions on PostgreSQL 13+,
 * and the `createdAt` index supports the default `ORDER BY createdAt DESC`
 * listing used by the API.
 */
export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('photos')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updatedAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('photos_created_at_idx').on('photos').column('createdAt').execute();
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('photos').ifExists().execute();
}
