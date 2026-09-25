import type { Insertable, Selectable, Updateable } from 'kysely';

import type { SchemaMigrationsTable } from './tables/schema-migrations.table';
import type { UserTable } from './tables/user.table';

/**
 * The database schema as Kysely sees it: one property per table, named exactly
 * like the SQL table. Every query in every repository is typed from this file,
 * so adding a table is a two-step change (table file + this interface).
 */
export interface DB {
  users: UserTable;
  schema_migrations: SchemaMigrationsTable;
}

/** What a `select` returns. */
export type UserRow = Selectable<UserTable>;
/** What an `insert` accepts. */
export type NewUserRow = Insertable<UserTable>;
/** What an `update` accepts. */
export type UserUpdateRow = Updateable<UserTable>;
