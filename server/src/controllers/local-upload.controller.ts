import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { LOCAL_UPLOAD_ROUTE } from '../constants';
import { ObjectStorageRepository } from '../repositories/object-storage.repository';

/**
 * Stand-in for S3's presigned `PUT` when `STORAGE_BACKEND=local`.
 *
 * The point of this route is that the browser-side flow stays identical across
 * backends: the client receives a URL, PUTs raw bytes at it, and never sees an
 * API-shaped multipart form. Here the URL points back at this process and the
 * "signature" is the HMAC token in the path.
 *
 * There is deliberately no `@Authenticated` guard — a presigned S3 URL carries
 * its own authorisation and cannot require headers the browser will not send.
 * The token *is* the authorisation: it is bound to one key, one byte budget and
 * one SHA-1, and it expires.
 *
 * The request body is intentionally left unparsed (no `@Body()`): the bytes are
 * streamed straight to disk and hashed on the way, so a rejected upload is
 * removed instead of being buffered in memory first.
 */
@Controller(LOCAL_UPLOAD_ROUTE)
export class LocalUploadController {
  constructor(private readonly storage: ObjectStorageRepository) {}

  @Put(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(@Param('token') token: string, @Req() request: Request): Promise<void> {
    // On S3 the equivalent URL is served by the bucket, not by this API, so the
    // route only exists to keep the local backend honest.
    if (this.storage.getBackend() !== 'local') {
      throw new NotFoundException();
    }

    const payload = this.storage.verifyLocalToken(token);

    await this.storage.writeLocalObject(payload.key, request, {
      size: payload.size,
      checksumSha1Hex: payload.checksumSha1Hex,
    });
  }
}
