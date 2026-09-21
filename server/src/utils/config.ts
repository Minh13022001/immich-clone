import type { ConfigService } from '@nestjs/config';

import type { Env } from '../validation';

/**
 * Reads the whole validated environment out of Nest's `ConfigService`.
 *
 * `ConfigModule.forRoot({ validate: validateEnv })` guarantees the shape, so
 * reading each key with `{ infer: true }` yields the exact type from the zod
 * schema rather than `string | undefined`.
 */
export function readEnv(config: ConfigService<Env, true>): Env {
  return {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    PORT: config.get('PORT', { infer: true }),
    DB_HOST: config.get('DB_HOST', { infer: true }),
    DB_PORT: config.get('DB_PORT', { infer: true }),
    DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
    DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
    DB_DATABASE_NAME: config.get('DB_DATABASE_NAME', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
  };
}

/**
 * Builds the libpq connection string used by both the API pool and the
 * migration script.
 */
export function buildDatabaseUrl(env: Env): string {
  const user = encodeURIComponent(env.DB_USERNAME);
  const password = encodeURIComponent(env.DB_PASSWORD);

  return `postgres://${user}:${password}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_DATABASE_NAME}`;
}

/** `"http://a, http://b"` -> `['http://a', 'http://b']`. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
