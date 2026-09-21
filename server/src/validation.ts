import { z } from 'zod';

import { DEFAULT_CORS_ORIGINS, DEFAULT_PORT } from './constants';

/**
 * Environment contract for the API.
 *
 * Every value has a development-friendly default, so `pnpm dev` works with no
 * `.env` at all, while deployment can override anything through real env vars.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USERNAME: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_DATABASE_NAME: z.string().min(1).default('immich'),

  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default(DEFAULT_CORS_ORIGINS),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to `ConfigModule.forRoot({ validate })`.
 *
 * Nest hands us the merged `process.env` and expects the validated object back.
 * Throwing here fails fast at boot instead of surfacing as a confusing runtime
 * error later, e.g. when the first query runs.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.message}`);
  }

  return result.data;
}
