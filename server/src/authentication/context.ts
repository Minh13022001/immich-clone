import type { Request } from 'express';

/**
 * Permission vocabulary (spec §2, D2).
 *
 * The reference gates routes on a permission; this clone only has `asset.upload`
 * and, by decision D2, every resolved user holds it.
 */
export enum Permission {
  AssetUpload = 'asset.upload',
}

/** The authenticated principal, projected from a `users` row. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** `null` means unlimited. */
  quotaSizeInBytes: number | null;
  quotaUsageInBytes: number;
}

/**
 * Request identity. `sharedLink` is always `null`: shared links are out of scope
 * by explicit decision (D3), but the field is kept so call sites mirror the spec.
 */
export interface AuthContext {
  user: AuthUser;
  sharedLink: null;
}

/** Metadata key set by `@Authenticated` and read by `AuthGuard`. */
export const PERMISSION_METADATA = 'authenticated:permission';

/** An Express request once `AuthGuard` has resolved its identity. */
export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

/** Headers can arrive as `string | string[]`; take the first usable value. */
export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
