import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { USER_EMAIL_MAX_LENGTH, USER_NAME_MAX_LENGTH } from '../constants';

/**
 * Request bodies for the user endpoints.
 *
 * Validation lives on the DTO, not in the controller or service, so the global
 * `ValidationPipe` rejects bad payloads with a 400 before any code runs.
 * `name`/`email` are the only writable fields: ids and timestamps are
 * server-owned.
 */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  name!: string;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(USER_EMAIL_MAX_LENGTH)
  email!: string;
}

/**
 * PATCH body. Every field is optional so a caller can rename, re-address or
 * change both at once; the service only writes the keys it actually receives.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(USER_EMAIL_MAX_LENGTH)
  email?: string;
}
