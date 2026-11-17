import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Kysely, sql } from 'kysely';

import type { DB } from '../schema';
import { readEnv } from '../utils/config';
import { createDatabase } from '../utils/database';
import type { Env } from '../validation';

/**
 * Owns the single Kysely/pg connection pool for the process.
 *
 * Feature repositories depend on this instead of building their own client,
 * which keeps one pool and one shutdown path. Because the class lives in
 * `repositories/`, no separate database module/provider token is needed — the
 * provider registries in `app.module.ts` wire it up.
 */
@Injectable()
export class DatabaseRepository implements OnApplicationShutdown {
  readonly db: Kysely<DB>;

  constructor(config: ConfigService<Env, true>) {
    this.db = createDatabase<DB>(readEnv(config));
  }

  /** Round-trips a trivial query; health checks fail if Postgres is down. */
  async ping(): Promise<void> {
    await sql`select 1`.execute(this.db);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
