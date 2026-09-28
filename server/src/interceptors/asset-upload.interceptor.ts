import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, of } from 'rxjs';

import { firstHeaderValue, type AuthenticatedRequest } from '../authentication/context';
import { AssetMediaService } from '../services/asset-media.service';

/**
 * Header a client sends once it has already hashed a file locally, letting the
 * server answer "duplicate" without reading the body at all (spec §5.2).
 */
export const UPLOAD_CHECKSUM_HEADER = 'x-immich-checksum';

/**
 * Pre-body duplicate fast path.
 *
 * Runs *before* `FileUploadInterceptor`, so when the checksum is already known
 * the multipart body is never parsed and nothing is written to disk. When the
 * lookup misses, it hands control to the next interceptor unchanged.
 */
@Injectable()
export class AssetUploadInterceptor implements NestInterceptor {
  constructor(private readonly assetService: AssetMediaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const checksum = firstHeaderValue(request.headers[UPLOAD_CHECKSUM_HEADER]);

    const duplicate = await this.assetService.getUploadAssetIdByChecksum(request.auth, checksum);

    if (duplicate) {
      // Nest would default this POST to 201; a header-only duplicate is a 200
      // with the existing asset's id (spec §4.1).
      response.status(200);
      return of(duplicate);
    }

    return next.handle();
  }
}
