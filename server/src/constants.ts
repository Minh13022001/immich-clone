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
