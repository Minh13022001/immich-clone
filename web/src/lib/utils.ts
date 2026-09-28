import { ApiError } from '@immich/sdk';

/** Renders an ISO timestamp as a local, human-readable string. */
export function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Turns whatever was thrown into one sentence.
 *
 * The API answers errors with Nest's shape (`{ statusCode, message }`), and
 * `message` can be a string or an array of class-validator messages.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return apiMessage(error) ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function apiMessage(error: ApiError): string | null {
  const { body } = error;

  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return null;
  }

  const { message } = body as { message: unknown };

  if (typeof message === 'string') {
    return message;
  }

  if (
    Array.isArray(message) &&
    message.every((entry): entry is string => typeof entry === 'string')
  ) {
    return message.join(', ');
  }

  return null;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTE_STEP = 1024;

/** Renders a byte count with a binary unit, e.g. `4.2 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  let value = bytes;
  let unit = 0;

  while (value >= BYTE_STEP && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_STEP;
    unit += 1;
  }

  const label = BYTE_UNITS[unit] ?? 'B';

  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${label}`;
}

/** A byte rate, e.g. `1.4 MB/s`. */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Renders seconds remaining as `45s` below a minute, otherwise `m:ss`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }

  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);

  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}
