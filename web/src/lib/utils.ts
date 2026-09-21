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
