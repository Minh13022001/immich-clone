import { UseGuards } from '@nestjs/common';

import { PERMISSION_METADATA, type Permission } from '../authentication/context';
import { AuthGuard } from './auth.guard';

/** Options accepted by `@Authenticated`. */
export interface AuthenticatedOptions {
  permission?: Permission;
}

/**
 * Declares that a route needs an authenticated identity (spec §5.1).
 *
 * Combines metadata with the guard so the two can never drift: `AuthGuard` reads
 * the permission this decorator stores. Mirrors the reference's
 * `@Authenticated({ permission, sharedLink })` minus the shared-link half (D3).
 */
export function Authenticated(options: AuthenticatedOptions = {}): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    if (descriptor.value) {
      Reflect.defineMetadata(PERMISSION_METADATA, options.permission, descriptor.value as object);
    }

    UseGuards(AuthGuard)(target, propertyKey, descriptor);
  };
}
