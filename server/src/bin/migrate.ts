import { Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Kysely, sql } from 'kysely';

import { MIGRATION_DATABASE_POOL_SIZE } from '../constants';
import type { DB } from '../schema';
import { migrations } from '../schema/migrations';
import { createDatabase } from '../utils/database';
import { validateEnv } from '../validation';

/**
 * Migration runner: `up` (default) | `down` | `reset`.
 *
 * It is a plain script rather than part of the Nest application so that a
 * deployment can migrate the database before any instance starts serving
 * traffic. It reads the same live registry (`schema/migrations`) the app uses,
 * and records applied names in `schema_migrations` so runs are idempotent.
 */
const logger = new Logger('Migrate');

type Command = 'up' | 'down' | 'reset';

/**
 * Loads `server/.env` into `process.env` before it is validated.
 *
 * `ConfigModule.forRoot` does this for the Nest application, but this script
 * runs outside Nest. Without it a host-run `pnpm migrations:run` ignores the
 * file entirely and silently falls back to the schema defaults (port 5432),
 * connecting to the wrong database. Variables already present in the real
 * environment win, matching the behaviour of `node --env-file`.
 */
function loadServerEnv(): void {
  const envFile = resolve(__dirname, '../../.env');

  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

async function ensureMigrationsTable(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('schema_migrations')
    .addColumn('name', 'text', (column) => column.primaryKey())
    .addColumn('runAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .ifNotExists() // do nothing if this table is existed
    .execute();
}

async function getApplied(db: Kysely<DB>): Promise<Set<string>> {
  const rows = await db.selectFrom('schema_migrations').select('name').execute();
  return new Set(rows.map((row) => row.name));
}

export async function up(db: Kysely<DB>): Promise<void> {
  await ensureMigrationsTable(db);
  const applied = await getApplied(db);
  console.log(applied , 6666);
  //Set(2) { '1789862400000-CreatePhotos', '1789862400000-CreateUsers' } 6666
  console.log(migrations, 6667);
  // [
  //   {
  //     name: '1789862400000-CreateUsers',
  //     up: [AsyncFunction: up],
  //     down: [AsyncFunction: down]
  //   }
  // ] 6667

  let count = 0;
  // if there are migration file already run, skip it
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }

  // if there are migration file not run yet, run it, and record it in schema_migrations table
    logger.log(`Applying ${migration.name}`);
    await migration.up(db);
    await db.insertInto('schema_migrations').values({ name: migration.name }).execute();
    count += 1;
  }

  logger.log(count === 0 ? 'Already up to date' : `Applied ${count} migration(s)`);
}

export async function down(db: Kysely<DB>): Promise<void> {
  await ensureMigrationsTable(db);

  // Walk the registry backwards rather than trusting `runAt` ordering: the
  // registry is the source of truth for "what came last".
  const applied = await getApplied(db);
  const last = [...migrations].reverse().find((migration) => applied.has(migration.name));

  if (!last) {
    logger.log('Nothing to roll back');
    return;
  }

  logger.log(`Reverting ${last.name}`);
  await last.down(db);
  await db.deleteFrom('schema_migrations').where('name', '=', last.name).execute();
}

export async function reset(db: Kysely<DB>): Promise<void> {
  logger.warn('Dropping all tables and re-applying every migration');
  // Child tables first: they hold foreign keys into `asset` (and `asset` into
  // `users`), so dropping out of order needs `cascade` on every table anyway.
  await db.schema.dropTable('asset_metadata').ifExists().cascade().execute();
  await db.schema.dropTable('exif').ifExists().cascade().execute();
  await db.schema.dropTable('asset_file').ifExists().cascade().execute();
  await db.schema.dropTable('asset').ifExists().cascade().execute();
  await db.schema.dropTable('users').ifExists().cascade().execute();
  await db.schema.dropTable('schema_migrations').ifExists().cascade().execute();
  await up(db);
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'up') as Command;

  loadServerEnv();

  const db = createDatabase<DB>(validateEnv(process.env), MIGRATION_DATABASE_POOL_SIZE);

  try {
    switch (command) {
      case 'up':
        await up(db);
        break;
      case 'down':
        await down(db);
        break;
      case 'reset':
        await reset(db);
        break;
      default:
        throw new Error(`Unknown command "${command}". Expected one of: up, down, reset`);
    }
  } finally {
    await db.destroy();
  }
}

void main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
