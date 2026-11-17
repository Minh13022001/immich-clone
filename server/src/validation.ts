import { z } from 'zod';

import {
  DEFAULT_CORS_ORIGINS,
  DEFAULT_MAX_UPLOAD_SIZE,
  DEFAULT_MEDIA_ROOT,
  DEFAULT_MULTIPART_THRESHOLD,
  DEFAULT_PART_SIZE,
  DEFAULT_PORT,
  DEFAULT_PRESIGN_TTL_SECONDS,
  DEFAULT_PUBLIC_API_URL,
  DEFAULT_S3_BUCKET,
  DEFAULT_S3_REGION,
  DEFAULT_STORAGE_BACKEND,
  DEFAULT_UPLOAD_SESSION_TTL_SECONDS,
} from './constants';

/**
 * `"true"` / `"false"` -> boolean.
 *
 * `z.coerce.boolean()` is unusable here because it maps every non-empty string
 * (including `"false"`) to `true`.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .default('false')
  .transform((value) => value === true || value === 'true');

/**
 * Environment contract for the API.
 *
 * Every value has a development-friendly default, so `pnpm dev` works with no
 * `.env` at all, while deployment can override anything through real env vars.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),

    DB_HOST: z.string().min(1).default('localhost'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USERNAME: z.string().min(1).default('postgres'),
    DB_PASSWORD: z.string().default('postgres'),
    DB_DATABASE_NAME: z.string().min(1).default('immich'),

    /** Comma-separated list of allowed browser origins. */
    CORS_ORIGINS: z.string().default(DEFAULT_CORS_ORIGINS),

    /** Filesystem root used by the local backend and by legacy uploads. */
    MEDIA_ROOT: z.string().min(1).default(DEFAULT_MEDIA_ROOT),

    /** `local` (disk, no S3 needed) or `s3` (presigned direct uploads). */
    STORAGE_BACKEND: z.enum(['local', 's3']).default(DEFAULT_STORAGE_BACKEND),

    /**
     * Browser-reachable base URL of this API. Only needed by the local backend,
     * which signs its own PUT URLs instead of asking S3 to sign them.
     */
    PUBLIC_API_URL: z.string().min(1).default(DEFAULT_PUBLIC_API_URL),

    /** Secret used to sign local-backend upload tokens. */
    UPLOAD_TOKEN_SECRET: z.string().min(8).default('dev-upload-token-secret'),

    /** Lifetime of a presigned URL (and of the pending upload session). */
    PRESIGN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_PRESIGN_TTL_SECONDS),

    /** Abandoned sessions older than this are aborted and their quota refunded. */
    UPLOAD_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_UPLOAD_SESSION_TTL_SECONDS),

    /** Single-request uploads above this size switch to multipart. */
    MULTIPART_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_MULTIPART_THRESHOLD),

    /** Size of each multipart part. */
    PART_SIZE: z.coerce.number().int().positive().default(DEFAULT_PART_SIZE),

    /** Largest single upload the API will authorise. */
    MAX_UPLOAD_SIZE: z.coerce.number().int().positive().default(DEFAULT_MAX_UPLOAD_SIZE),

    /** S3-compatible endpoint (MinIO, R2, real S3). Empty = AWS default. */
    S3_ENDPOINT: z.string().optional(),

    /**
     * Endpoint used *when signing*. Must be reachable from the browser, which is
     * why it is separate from `S3_ENDPOINT` (in Docker that one is `minio:9000`).
     */
    S3_PUBLIC_ENDPOINT: z.string().optional(),

    S3_REGION: z.string().min(1).default(DEFAULT_S3_REGION),
    S3_BUCKET: z.string().min(1).default(DEFAULT_S3_BUCKET),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanish,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_BACKEND !== 's3') {
      return;
    }

    // Failing at boot beats discovering a missing credential on the first upload.
    for (const key of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when STORAGE_BACKEND=s3`,
        });
      }
    }
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
