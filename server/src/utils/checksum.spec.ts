import { describe, expect, it } from 'vitest';

import { ASSET_CHECKSUM_CONSTRAINT } from '../constants';
import { decodeChecksum, fromChecksum, isAssetChecksumConstraint, toChecksum } from './checksum';

/** Checksum codec + constraint detection (spec §4.2, §9.3). */
const CHECKSUM_HEX = '3f1a9c0b7d4e5f60718293a4b5c6d7e8f9012345';

describe('decodeChecksum', () => {
  it('decodes a 40-character hex digest', () => {
    const decoded = decodeChecksum(CHECKSUM_HEX);

    expect(decoded).toHaveLength(20);
    expect(decoded.equals(toChecksum(CHECKSUM_HEX))).toBe(true);
  });

  it('decodes a 28-character base64 digest', () => {
    const base64 = toChecksum(CHECKSUM_HEX).toString('base64');

    expect(base64).toHaveLength(28);
    expect(decodeChecksum(base64).equals(toChecksum(CHECKSUM_HEX))).toBe(true);
  });

  it('falls back to hex when a 28-character string is not a 20-byte base64 digest', () => {
    // "aaaa..." is valid in both alphabets, but base64-decoding it yields 21
    // bytes, so the hex branch must win rather than producing a bogus digest.
    const ambiguous = 'a'.repeat(28);

    expect(decodeChecksum(ambiguous)).toHaveLength(14);
  });
});

describe('toChecksum / fromChecksum', () => {
  it('round-trips a hex digest', () => {
    expect(fromChecksum(toChecksum(CHECKSUM_HEX))).toBe(CHECKSUM_HEX);
  });

  it('normalises an uppercase digest to lowercase', () => {
    expect(fromChecksum(toChecksum(CHECKSUM_HEX.toUpperCase()))).toBe(CHECKSUM_HEX);
  });
});

describe('isAssetChecksumConstraint', () => {
  it('matches only the unique violation on the asset checksum index', () => {
    expect(
      isAssetChecksumConstraint({ code: '23505', constraint: ASSET_CHECKSUM_CONSTRAINT }),
    ).toBe(true);
  });

  it('rejects a unique violation on another constraint', () => {
    expect(isAssetChecksumConstraint({ code: '23505', constraint: 'users_email_key' })).toBe(false);
  });

  it('rejects a different error code on the same index', () => {
    expect(
      isAssetChecksumConstraint({ code: '23503', constraint: ASSET_CHECKSUM_CONSTRAINT }),
    ).toBe(false);
  });

  it('rejects anything that is not an object', () => {
    expect(isAssetChecksumConstraint(null)).toBe(false);
    expect(isAssetChecksumConstraint(undefined)).toBe(false);
    expect(isAssetChecksumConstraint('23505')).toBe(false);
  });
});
