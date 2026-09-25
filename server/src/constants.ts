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

/** Reported by `GET /api/server-info`. */
export const APP_NAME = 'immich-clone';
export const APP_VERSION = '0.1.0';
