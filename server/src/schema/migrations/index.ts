import type { Kysely } from 'kysely';

import type { DB } from '../index';
import * as CreatePhotos from './1789862400000-CreatePhotos';

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
    name: '1789862400000-CreatePhotos',
    up: CreatePhotos.up,
    down: CreatePhotos.down,
  },
];
