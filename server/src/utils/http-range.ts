/**
 * The slice of RFC 7233 an asset endpoint actually needs.
 *
 * Only a single `bytes=start-end` or `bytes=start-` range is understood. Every
 * other form — a different unit, several comma-separated ranges, or a suffix
 * range such as `bytes=-500` — is treated as "no range requested" and answered
 * with the whole entity. The spec explicitly allows a server to ignore `Range`,
 * and doing so keeps this endpoint free of a second (416) error path while
 * still satisfying `<video>` seeking, which only ever sends `bytes=`.
 */
export interface ByteRange {
  start: number;
  /** Inclusive end, absent when the client asked for "through the end". */
  end?: number;
}

/** Parses a `Range` header value, or `undefined` when it should be ignored. */
export function parseByteRange(header: string | undefined): ByteRange | undefined {
  if (!header) {
    return undefined;
  }

  const match = /^\s*bytes\s*=\s*(\d+)\s*-\s*(\d*)\s*$/i.exec(header);

  if (!match) {
    return undefined;
  }

  const start = Number(match[1]);

  if (!Number.isSafeInteger(start)) {
    return undefined;
  }

  const rawEnd = match[2];

  if (!rawEnd) {
    return { start };
  }

  const end = Number(rawEnd);

  // A backwards or malformed window is not worth a 416: serve everything.
  if (!Number.isSafeInteger(end) || end < start) {
    return undefined;
  }

  return { start, end };
}

/**
 * Fits a parsed range to the real size of the object.
 *
 * Returns `undefined` when the caller should serve the full entity — either
 * because no range was asked for, the object is empty, or the requested start
 * lies past the last byte. Clamping the end (rather than rejecting it) matches
 * how S3 and `fs.createReadStream` behave.
 */
export function clampByteRange(range: ByteRange | undefined, total: number): ByteRange | undefined {
  if (!range || total <= 0 || range.start >= total) {
    return undefined;
  }

  if (range.end === undefined) {
    return { start: range.start };
  }

  return range.end >= total ? { start: range.start, end: total - 1 } : range;
}

/** Renders the `Content-Range` value for a slice of `total` bytes. */
export function formatContentRange(start: number, end: number, total: number): string {
  return `bytes ${start}-${end}/${total}`;
}
