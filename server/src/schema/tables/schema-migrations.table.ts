import type { Generated } from 'kysely';

/**
 * Bookkeeping table for the migration runner. The runner creates it lazily on
 * first run, so it is declared here only so Kysely can type queries against it.
 */
export interface SchemaMigrationsTable {
  name: string;
  runAt: Generated<Date>;
}
