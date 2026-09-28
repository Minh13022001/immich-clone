import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';

import { Permission, type AuthenticatedRequest } from '../authentication/context';
import {
  AssetMediaStatus,
  BulkUploadCheckDto,
  CreateAssetDto,
  UploadFieldName,
  type AssetMediaResponseDto,
  type BulkUploadCheckResponseDto,
} from '../dtos/asset-media.dto';
import { AssetUploadInterceptor } from '../interceptors/asset-upload.interceptor';
import {
  FileUploadInterceptor,
  RouteKey,
  UploadRoute,
} from '../interceptors/file-upload.interceptor';
import { Authenticated } from '../middleware/authenticated.decorator';
import { FileNotEmptyValidator, getUploadedFile } from '../middleware/file-not-empty.validator';
import { AssetMediaService } from '../services/asset-media.service';

/**
 * HTTP surface for asset uploads (spec §5.1).
 *
 * The controller stays thin: interceptors materialise the binary parts, and all
 * persistence decisions live in `AssetMediaService`. Its only real job is
 * choosing the status code — 201 for a new asset, 200 when the upload turned out
 * to be a duplicate.
 */
@Controller('assets')
export class AssetMediaController {
  private readonly fileNotEmpty = new FileNotEmptyValidator([UploadFieldName.ASSET_DATA]);

  constructor(private readonly assetService: AssetMediaService) {}

  @Post()
  @Authenticated({ permission: Permission.AssetUpload })
  // Order matters: the checksum fast path can short-circuit before multer reads
  // a single byte of the body.
  @UseInterceptors(AssetUploadInterceptor, FileUploadInterceptor)
  @UploadRoute(RouteKey.Asset)
  async uploadAsset(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAssetDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AssetMediaResponseDto> {
    this.fileNotEmpty.validate(request);

    const file = getUploadedFile(request, UploadFieldName.ASSET_DATA);
    const sidecarFile = getUploadedFile(request, UploadFieldName.SIDECAR_DATA);

    if (!file) {
      // `fileNotEmpty` already threw, so this only satisfies the type checker.
      throw new Error('Asset part was not parsed');
    }

    const result = await this.assetService.uploadAsset(request.auth, dto, file, sidecarFile);

    if (result.status === AssetMediaStatus.DUPLICATE) {
      response.status(HttpStatus.OK);
    }

    return result;
  }

  @Post('bulk-upload-check')
  @Authenticated({ permission: Permission.AssetUpload })
  @HttpCode(HttpStatus.OK)
  bulkUploadCheck(
    @Req() request: AuthenticatedRequest,
    @Body() dto: BulkUploadCheckDto,
  ): Promise<BulkUploadCheckResponseDto> {
    return this.assetService.bulkUploadCheck(request.auth, dto);
  }
}
