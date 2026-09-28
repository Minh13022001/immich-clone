import type { Insertable, Selectable, Updateable } from 'kysely';

import type { AssetFileTable } from './tables/asset-file.table';
import type { AssetMetadataTable } from './tables/asset-metadata.table';
import type { AssetTable } from './tables/asset.table';
import type { ExifTable } from './tables/exif.table';
import type { SchemaMigrationsTable } from './tables/schema-migrations.table';
import type { UserTable } from './tables/user.table';

/**
 * The database schema as Kysely sees it: one property per table, named exactly
 * like the SQL table. Every query in every repository is typed from this file,
 * so adding a table is a two-step change (table file + this interface).
 */
export interface DB {
  users: UserTable;
  asset: AssetTable;
  asset_file: AssetFileTable;
  exif: ExifTable;
  asset_metadata: AssetMetadataTable;
  schema_migrations: SchemaMigrationsTable;
}

/** What a `select` returns. */
export type UserRow = Selectable<UserTable>;
/** What an `insert` accepts. */
export type NewUserRow = Insertable<UserTable>;
/** What an `update` accepts. */
export type UserUpdateRow = Updateable<UserTable>;

export type AssetRow = Selectable<AssetTable>;
export type NewAssetRow = Insertable<AssetTable>;
export type AssetUpdateRow = Updateable<AssetTable>;

export type AssetFileRow = Selectable<AssetFileTable>;
export type NewAssetFileRow = Insertable<AssetFileTable>;

export type ExifRow = Selectable<ExifTable>;
export type NewExifRow = Insertable<ExifTable>;
export type ExifUpdateRow = Updateable<ExifTable>;

export type AssetMetadataRow = Selectable<AssetMetadataTable>;
export type NewAssetMetadataRow = Insertable<AssetMetadataTable>;
