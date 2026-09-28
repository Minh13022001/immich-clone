import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';

import { DATABASE_POOL_SIZE } from '../constants';
import type { Env } from '../validation';
import { buildDatabaseUrl } from './config';

/**
 * `node-postgres` returns `int8`/`bigint` columns as strings to avoid precision
 * loss. File sizes and quota counters comfortably fit a JS number here, and the
 * upload service does arithmetic on them, so parse `int8` as a number.
 */
types.setTypeParser(20, (value) => Number(value));

/**
 * Creates a Kysely instance over a `pg` pool.
 *
 * The caller owns the returned object and must `destroy()` it on shutdown —
 * `DatabaseRepository` does that for the API, the migration script does it when
 * it finishes. `Schema` is generic because migrations run before the tables
 * they create exist.
 */
export function createDatabase<Schema>(env: Env, poolSize = DATABASE_POOL_SIZE): Kysely<Schema> {
  return new Kysely<Schema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: buildDatabaseUrl(env),
        max: poolSize,
      }),
    }),
  });
}
