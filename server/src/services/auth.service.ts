import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthContext, AuthUser, Permission } from '../authentication/context';
import { Permission as PermissionEnum } from '../authentication/context';
import { DEFAULT_USER_EMAIL, DEFAULT_USER_NAME } from '../constants';
import { UserRepository } from '../repositories/user.repository';

/**
 * The authentication shim (decision D1).
 *
 * There is no login flow in this clone. A caller may name a user with the
 * `x-user-id` header; without one, a seeded default user is used (created lazily
 * on first request). Everything downstream sees the same `AuthContext` the
 * reference would build from a real session.
 */
@Injectable()
export class AuthService {
  private defaultUserId?: string;

  constructor(private readonly userRepository: UserRepository) {}

  async resolve(headerUserId?: string): Promise<AuthContext> {
    const userId =
      headerUserId && headerUserId.length > 0 ? headerUserId : await this.getDefaultUserId();

    const row = await this.userRepository.getById(userId);

    if (!row) {
      if (headerUserId) {
        throw new UnauthorizedException(`Unknown user ${headerUserId}`);
      }

      throw new InternalServerErrorException('Default user could not be resolved');
    }

    const user: AuthUser = {
      id: row.id,
      name: row.name,
      email: row.email,
      quotaSizeInBytes: row.quotaSizeInBytes,
      quotaUsageInBytes: row.quotaUsageInBytes,
    };

    return { user, sharedLink: null };
  }

  /**
   * Permission check (D2). Every resolved identity holds `asset.upload`; the
   * method exists so the guard reads like the reference and future permissions
   * have an obvious home.
   */
  requirePermission(auth: AuthContext, permission: Permission): void {
    if (!auth.user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (permission === PermissionEnum.AssetUpload) {
      return;
    }

    throw new ForbiddenException(`Permission ${permission} is not granted`);
  }

  /** Lazily resolves (or creates) the fallback user used by header-less requests. */
  private async getDefaultUserId(): Promise<string> {
    if (this.defaultUserId) {
      return this.defaultUserId;
    }

    const users = await this.userRepository.getAll();
    // `getAll` is newest-first, so the oldest row is the most stable choice.
    const existing = users.at(-1);
    if (existing) {
      this.defaultUserId = existing.id;
      return existing.id;
    }

    try {
      const created = await this.userRepository.create({
        name: DEFAULT_USER_NAME,
        email: DEFAULT_USER_EMAIL,
      });
      this.defaultUserId = created.id;
      return created.id;
    } catch {
      // Another request created it first; re-read and take whatever exists.
      const raced = await this.userRepository.getAll();
      const winner = raced.at(-1);
      if (!winner) {
        throw new InternalServerErrorException('Default user could not be resolved');
      }
      this.defaultUserId = winner.id;
      return winner.id;
    }
  }
}
