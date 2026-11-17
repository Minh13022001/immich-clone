/**
 * Server-wide constants.
 *
 * The reference project keeps a `constants.ts` at the root of `src/` so that
 * both infrastructure code and feature code share one definition for the API
 * prefix, ports and limits. We mirror that layout with only the values this
 * clone actually needs.
 */

/** Every route is served under this prefix (`localhost:2283/api/...`). */
export const API_PREFIX = 'api';

/** Default HTTP port for the API. */
export const DEFAULT_PORT = 2283;

/** Default browser origin allowed by CORS during local development. */
export const DEFAULT_CORS_ORIGINS = 'http://localhost:3000';

/** Maximum number of characters allowed in a user name. */
export const USER_NAME_MAX_LENGTH = 255;

/** Maximum number of characters allowed in a user email address. */
export const USER_EMAIL_MAX_LENGTH = 320;

/** Connection pool ceiling for the API process. */
export const DATABASE_POOL_SIZE = 10;

/** Connection pool ceiling for short-lived scripts (migrations). */
export const MIGRATION_DATABASE_POOL_SIZE = 1;

/**
 * Where uploaded originals live when `MEDIA_ROOT` is unset. Relative paths are
 * resolved against the process working directory (the dev default is `server/`).
 */
export const DEFAULT_MEDIA_ROOT = './data';

/**
 * Name of the unique index on `asset(ownerId, checksum)` (spec §2). Quoted at
 * creation so Postgres keeps this exact spelling; the service matches on it to
 * tell a duplicate-upload violation apart from any other unique violation.
 */
export const ASSET_CHECKSUM_CONSTRAINT = 'ASSET_CHECKSUM_CONSTRAINT';

/**
 * Identity shim defaults (see `plans/asset-upload-decisions.md` D1). This clone
 * has no authentication, so a request without an `x-user-id` header is served as
 * this seeded user, created on first use.
 */
export const DEFAULT_USER_NAME = 'Default User';
export const DEFAULT_USER_EMAIL = 'default@immich.local';

/** Reported by `GET /api/server-info`. */
export const APP_NAME = 'immich-clone';
export const APP_VERSION = '0.1.0';

/**
 * Which object-storage backend the API writes through.
 *
 * `local` keeps the pre-S3 behaviour (files under `MEDIA_ROOT`) and is the
 * default so `pnpm dev` and the unit suites keep working with no MinIO.
 * `s3` switches both the presigned upload flow and the read/delete paths to S3.
 */
export const DEFAULT_STORAGE_BACKEND = 'local';

/** Default destination bucket (private; never made public). */
export const DEFAULT_S3_BUCKET = 'immich-clone';
export const DEFAULT_S3_REGION = 'us-east-1';

/** Absolute base URL the API is reachable at, used to build local presigned URLs. */
export const DEFAULT_PUBLIC_API_URL = 'http://localhost:2283';

/** How long a presigned URL (and therefore a pending upload) stays usable. */
export const DEFAULT_PRESIGN_TTL_SECONDS = 15 * 60;

/** Files above this size use S3 multipart instead of a single `PutObject`. */
export const DEFAULT_MULTIPART_THRESHOLD = 64 * 1024 * 1024;

/** Multipart part size; S3 requires >= 5 MiB for every part but the last. */
export const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

/** Hard ceiling for a single upload, enforced before any URL is issued. */
export const DEFAULT_MAX_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024;

/** Abandoned `asset_upload` sessions older than this are swept and refunded. */
export const DEFAULT_UPLOAD_SESSION_TTL_SECONDS = 60 * 60;

/**
 * Partial unique index on `asset_upload(ownerId, checksum)` for sessions that
 * have not reached a terminal state. It makes retries and concurrent uploads of
 * the same bytes converge on one session instead of racing to two asset rows.
 */
export const ASSET_UPLOAD_ACTIVE_CHECKSUM = 'ASSET_UPLOAD_ACTIVE_CHECKSUM';

/** How often the sweeper looks for abandoned `asset_upload` sessions. */
export const UPLOAD_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * A session left in `verifying` this long means the process died inside
 * `/complete`. The window is generous on purpose: a large object still being
 * digested must never be reclaimed out from under a live request.
 */
export const UPLOAD_VERIFY_TIMEOUT_MS = 30 * 60 * 1000;

/** Directory (under `MEDIA_ROOT`) holding S3-shaped keys when `STORAGE_BACKEND=local`. */
export const LOCAL_OBJECT_ROOT = 'objects';

/** Route the local backend uses in place of S3's presigned PUT. */
export const LOCAL_UPLOAD_ROUTE = 'uploads/local';
