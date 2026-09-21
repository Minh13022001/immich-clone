import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PHOTO_NAME_MAX_LENGTH } from '../constants';

/**
 * Request bodies for the photo endpoints.
 *
 * Validation lives on the DTO, not in the controller or service, so the global
 * `ValidationPipe` rejects bad payloads with a 400 before any code runs.
 * `name` is the only writable field: ids and timestamps are server-owned.
 */
export class CreatePhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PHOTO_NAME_MAX_LENGTH)
  name!: string;
}

/**
 * PATCH body. The only mutable field is `name`, so an update that changes
 * nothing is not a meaningful request — `name` stays required.
 */
export class UpdatePhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PHOTO_NAME_MAX_LENGTH)
  name!: string;
}
