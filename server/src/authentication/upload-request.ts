import type { Request } from 'express';

import { UploadFieldName, type CreateAssetDto } from '../dtos/asset-media.dto';
import type { AuthContext } from './context';

/**
 * A multer file after our streaming storage has handled it.
 *
 * `uuid` is assigned by the storage engine and drives the sharded folder path;
 * `checksum` is only populated for `assetData` (it is the incremental SHA-1 of
 * the bytes written).
 */
export interface MulterFile extends Express.Multer.File {
  uuid: string;
  checksum?: Buffer;
}

/**
 * The shape every upload helper consumes (`canUploadFile`, `getUploadFilename`,
 * `getUploadFolder`, `uploadAsset`). Keeping it a plain object rather than an
 * Express request makes the helpers trivial to unit-test.
 */
export interface UploadRequest {
  auth: AuthContext;
  fieldName: UploadFieldName;
  file: MulterFile;
  body: CreateAssetDto;
}

/**
 * Adapts a live request (plus one multer file) into an `UploadRequest`.
 *
 * `body` is not yet DTO-transformed when called from `fileFilter` (the global
 * pipe runs later), so callers that need typed fields — the service — receive the
 * validated DTO from the controller instead.
 */
export function asUploadRequest(request: Request, file: MulterFile): UploadRequest {
  const authenticated = request as Request & { auth: AuthContext };

  return {
    auth: authenticated.auth,
    fieldName: file.fieldname as UploadFieldName,
    file,
    body: (request.body ?? {}) as CreateAssetDto,
  };
}
