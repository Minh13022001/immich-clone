import type { Insertable, Selectable, Updateable } from 'kysely';

import type { PhotoTable } from './tables/photo.table';
import type { SchemaMigrationsTable } from './tables/schema-migrations.table';

/**
 * The database schema as Kysely sees it: one property per table, named exactly
 * like the SQL table. Every query in every repository is typed from this file,
 * so adding a table is a two-step change (table file + this interface).
 */
export interface DB {
  photos: PhotoTable;
  schema_migrations: SchemaMigrationsTable;
}

/** What a `select` returns. */
export type PhotoRow = Selectable<PhotoTable>;
/** What an `insert` accepts. */
export type NewPhotoRow = Insertable<PhotoTable>;
/** What an `update` accepts. */
export type PhotoUpdateRow = Updateable<PhotoTable>;
