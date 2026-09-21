import { Logger } from '@nestjs/common';
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

async function ensureMigrationsTable(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('schema_migrations')
    .addColumn('name', 'text', (column) => column.primaryKey())
    .addColumn('runAt', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .ifNotExists()
    .execute();
}

async function getApplied(db: Kysely<DB>): Promise<Set<string>> {
  const rows = await db.selectFrom('schema_migrations').select('name').execute();
  return new Set(rows.map((row) => row.name));
}

export async function up(db: Kysely<DB>): Promise<void> {
  await ensureMigrationsTable(db);
  const applied = await getApplied(db);

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }

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
  await db.schema.dropTable('photos').ifExists().cascade().execute();
  await db.schema.dropTable('schema_migrations').ifExists().cascade().execute();
  await up(db);
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'up') as Command;
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
