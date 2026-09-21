import { NotFoundException } from '@nestjs/common';

/**
 * Shared behaviour for domain services.
 *
 * The reference project gives every service a common base so that cross-cutting
 * concerns (error shaping, path handling, logging) are not re-invented per
 * feature. In this single-feature clone the only thing worth sharing is the
 * not-found check.
 */
export class BaseService {
  /** Returns `value`, or throws a 404 with `message` when it is missing. */
  protected assertFound<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new NotFoundException(message);
    }

    return value;
  }
}
