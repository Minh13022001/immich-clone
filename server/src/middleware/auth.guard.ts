import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import {
  firstHeaderValue,
  PERMISSION_METADATA,
  type AuthenticatedRequest,
  type Permission,
} from '../authentication/context';
import { AuthService } from '../services/auth.service';

/**
 * Resolves the request identity and attaches it as `request.auth`, then enforces
 * the permission declared by `@Authenticated`.
 *
 * Running as a guard means `request.auth` exists before any interceptor — which
 * is what lets `AssetUploadInterceptor` and multer's `fileFilter` make
 * permission decisions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = firstHeaderValue(request.headers['x-user-id']);

    request.auth = await this.authService.resolve(userId);

    const permission = Reflect.getMetadata(PERMISSION_METADATA, context.getHandler()) as
      Permission | undefined;

    if (permission) {
      this.authService.requirePermission(request.auth, permission);
    }

    return true;
  }
}
