import { type Kysely, sql } from 'kysely';

import type { DB } from '../index';

/**
 * Creates the `users` table — the only table in this clone.
 *
 * `gen_random_uuid()` is available without extra extensions on PostgreSQL 13+,
 * and the `createdAt` index supports the default `ORDER BY createdAt DESC`
 * listing used by the API. `email` carries a unique constraint so identity is
 * enforced by the database rather than by a check-then-insert race.
 */
export async function up(db: Kysely<DB>): Promise<void> {   // how this releated to the createUser ?
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('email', 'text', (column) => column.notNull().unique())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updatedAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('users_created_at_idx').on('users').column('createdAt').execute();
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
}
