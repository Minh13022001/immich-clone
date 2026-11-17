import type { Kysely } from 'kysely';

import type { DB } from '../index';
import * as CreateAssets from './1790000000000-CreateAssets';
import * as CreateUsers from './1789862400000-CreateUsers';
import * as CreateAssetUpload from './1800000000000-CreateAssetUpload';
import * as MakeChecksumUnique from './1800000000001-MakeChecksumUnique';
import * as AddStorageColumns from './1800000000002-AddStorageColumns';

/**
 * A single migration. `name` is what gets recorded in `schema_migrations` and
 * therefore must never change once applied.
 */
export interface Migration {
  name: string;
  up: (db: Kysely<DB>) => Promise<void>;
  down: (db: Kysely<DB>) => Promise<void>;
}

/**
 * The migration registry, in apply order. New migrations are appended here;
 * `bin/migrate.ts` never needs to change.
 */
export const migrations: Migration[] = [
  {
    name: '1789862400000-CreateUsers',
    up: CreateUsers.up,
    down: CreateUsers.down,
  },
  {
    name: '1790000000000-CreateAssets',
    up: CreateAssets.up,
    down: CreateAssets.down,
  },
  {
    name: '1800000000000-CreateAssetUpload',
    up: CreateAssetUpload.up,
    down: CreateAssetUpload.down,
  },
  {
    name: '1800000000001-MakeChecksumUnique',
    up: MakeChecksumUnique.up,
    down: MakeChecksumUnique.down,
  },
  {
    name: '1800000000002-AddStorageColumns',
    up: AddStorageColumns.up,
    down: AddStorageColumns.down,
  },
];
