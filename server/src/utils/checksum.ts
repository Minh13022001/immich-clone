import { ASSET_CHECKSUM_CONSTRAINT } from '../constants';

/**
 * Checksum codec (spec §3.4, §4.2).
 *
 * The database stores the raw SHA-1 digest in a `bytea` column, while clients
 * speak hex or base64. Everything crossing that boundary goes through here.
 */

/**
 * Decodes a client-supplied checksum into the raw digest.
 *
 * A base64-encoded SHA-1 is always 28 characters ("decoded length is 28 chars"
 * in §4.2 means the *encoded* string), so that length selects base64; anything
 * else is treated as hex. Note base64 is tried first because a 28-character hex
 * string is also syntactically valid hex and would decode to the wrong length.
 */
export function decodeChecksum(checksum: string): Buffer {
  if (checksum.length === 28) {
    const decoded = Buffer.from(checksum, 'base64');
    if (decoded.length === 20) {
      return decoded;
    }
  }

  return Buffer.from(checksum, 'hex');
}

/** Wraps a hex string as the raw digest buffer for insertion. */
export function toChecksum(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

/** Renders a stored digest as lowercase hex (the client-facing encoding here). */
export function fromChecksum(checksum: Buffer): string {
  return checksum.toString('hex');
}

/**
 * True when `error` is a Postgres unique violation on the asset checksum index.
 *
 * Kysely rethrows driver errors untouched, so `pg`'s `code`/`constraint`
 * properties survive. Matching the constraint name (not just `23505`) keeps a
 * duplicate upload from being confused with any future unique index.
 */
export function isAssetChecksumConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === '23505' && candidate.constraint === ASSET_CHECKSUM_CONSTRAINT;
}
