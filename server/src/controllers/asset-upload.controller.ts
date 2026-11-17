import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { Permission, type AuthenticatedRequest } from '../authentication/context';
import type {
  AssetUploadCompleteResponseDto,
  AssetUploadInitiateResponseDto,
  AssetUploadPartsResponseDto,
  CompleteAssetUploadDto,
  InitiateAssetUploadDto,
  RequestAssetUploadPartsDto,
} from '../dtos/asset-upload.dto';
import { Authenticated } from '../middleware/authenticated.decorator';
import { AssetUploadService } from '../services/asset-upload.service';

/**
 * Direct-to-storage upload surface.
 *
 * Unlike `POST /assets`, no bytes ever reach this process (except on the local
 * backend, which impersonates S3 through `LocalUploadController`). The client
 * declares what it is about to send, receives a presigned URL, uploads straight
 * to the bucket, then asks for the session to be verified and finalised.
 *
 * Status codes keep the legacy contract: 201 when an asset was created and 200
 * when the bytes were already known, so existing clients do not have to change
 * how they interpret the response.
 */
@Controller('assets/uploads')
export class AssetUploadController {
  constructor(private readonly uploadService: AssetUploadService) {}

  /** Step 1 — declare the file, get the URL (or learn it already exists). */
  @Post()
  @Authenticated({ permission: Permission.AssetUpload })
  async initiate(
    @Req() request: AuthenticatedRequest,
    @Body() dto: InitiateAssetUploadDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AssetUploadInitiateResponseDto> {
    const result = await this.uploadService.initiate(request.auth, dto);

    if (result.status === 'duplicate') {
      response.status(HttpStatus.OK);
    }

    return result;
  }

  /** Step 2 (large files only) — presign a bounded batch of part URLs. */
  @Post(':id/parts')
  @Authenticated({ permission: Permission.AssetUpload })
  @HttpCode(HttpStatus.OK)
  requestParts(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestAssetUploadPartsDto,
  ): Promise<AssetUploadPartsResponseDto> {
    return this.uploadService.requestParts(request.auth, id, dto);
  }

  /** Step 3 — the bytes are in storage; verify them, then create the asset. */
  @Post(':id/complete')
  @Authenticated({ permission: Permission.AssetUpload })
  async complete(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAssetUploadDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AssetUploadCompleteResponseDto> {
    const result = await this.uploadService.complete(request.auth, id, dto);

    if (result.status === 'duplicate') {
      response.status(HttpStatus.OK);
    }

    return result;
  }

  /** Give up on a session: abort the multipart upload, drop the bytes, refund. */
  @Post(':id/abort')
  @Authenticated({ permission: Permission.AssetUpload })
  @HttpCode(HttpStatus.NO_CONTENT)
  abort(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.uploadService.abort(request.auth, id);
  }
}
