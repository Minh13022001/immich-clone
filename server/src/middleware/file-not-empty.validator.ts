import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

import type { MulterFile } from '../authentication/upload-request';
import type { UploadFieldName } from '../dtos/asset-media.dto';

/**
 * Ensures the required binary parts exist and are non-empty (spec §5.6).
 *
 * The reference folds file parts into the DTO body and asserts this invariant
 * with a class-validator constraint, `FileNotEmptyValidator(['assetData'])`.
 * Multer keeps parts on `request.files` here, so this class asserts the same
 * invariant over that collection — same `400 File is empty` outcome.
 */
export class FileNotEmptyValidator {
  constructor(private readonly fields: UploadFieldName[]) {}

  validate(request: Request): void {
    for (const field of this.fields) {
      const file = getUploadedFile(request, field);

      if (!file || file.size === 0) {
        throw new BadRequestException('File is empty');
      }
    }
  }
}

/** Reads one named part from `request.files`, whichever multer handler ran. */
export function getUploadedFile(request: Request, field: string): MulterFile | undefined {
  const files = request.files;

  if (Array.isArray(files)) {
    return files.find((file) => file.fieldname === field) as MulterFile | undefined;
  }

  return files?.[field]?.[0] as MulterFile | undefined;
}

/** Flattens `request.files` into a list, tolerating both object and array shapes. */
export function collectUploadedFiles(request: Request): MulterFile[] {
  const files = request.files;

  if (Array.isArray(files)) {
    return files as MulterFile[];
  }

  if (!files) {
    return [];
  }

  return Object.values(files).flat() as MulterFile[];
}
