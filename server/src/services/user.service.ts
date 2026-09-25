import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { User } from '../database';
import type { CreateUserDto, UpdateUserDto } from '../dtos/user.dto';
import { UserRepository } from '../repositories/user.repository';
import type { UserRow, UserUpdateRow } from '../schema';
import { BaseService } from './base.service';

/** Postgres `unique_violation`, raised by the `users.email` constraint. */
const UNIQUE_VIOLATION = '23505';

/**
 * Business rules for users: normalise input, translate "no row" into 404 and a
 * duplicate email into 409, and expose domain objects rather than database rows.
 */
@Injectable()
export class UserService extends BaseService {
  constructor(private readonly userRepository: UserRepository) {
    super();
  }

  async create(dto: CreateUserDto): Promise<User> {
    const email = normalizeEmail(dto.email);

    try {
      const row = await this.userRepository.create({ name: dto.name.trim(), email });
      return this.toUser(row);
    } catch (error) {
      throw this.translateEmailConflict(error, email);
    }
  }

  async getAll(): Promise<User[]> {
    // Business layer. No HTTP concepts here — just "give me all users".
    const rows = await this.userRepository.getAll();
    return rows.map((row) => this.toUser(row));
  }

  async getById(id: string): Promise<User> {
    const row = await this.userRepository.getById(id);
    return this.toUser(this.assertFound(row, `User ${id} not found`));
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    // Only write the keys the caller actually sent: an absent field must not
    // blank out a column just because the PATCH body omitted it.
    const changes: UserUpdateRow = { updatedAt: new Date() };

    if (dto.name !== undefined) {
      changes.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      changes.email = normalizeEmail(dto.email);
    }

    try {
      const row = await this.userRepository.update(id, changes);
      return this.toUser(this.assertFound(row, `User ${id} not found`));
    } catch (error) {
      throw this.translateEmailConflict(error, dto.email);
    }
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.userRepository.delete(id);

    if (!deleted) {
      throw new NotFoundException(`User ${id} not found`);
    }
  }

  /**
   * Rows and domain objects are structurally identical today. The explicit
   * mapping keeps them decoupled: if the column layout changes, only this
   * method has to follow.
   */
  private toUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  /** Turns the database's unique-email violation into a 409; rethrows anything else. */
  private translateEmailConflict(error: unknown, email: string | undefined): unknown {
    if (isUniqueViolation(error)) {
      return new ConflictException(`Email ${email} is already in use`);
    }

    return error;
  }
}

/** Emails are case-insensitive in practice, so store one canonical form. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}
