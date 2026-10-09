import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
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
  type AssetResponseDto,
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
@Controller('assetsy')
export class AssetMediaController {
  private readonly fileNotEmpty = new FileNotEmptyValidator([UploadFieldName.ASSET_DATA]);

  constructor(private readonly assetService: AssetMediaService) {}

  /** Every asset the caller owns, newest first — backs the library page. */
  @Get()
  @Authenticated()
  listAssets(@Req() request: AuthenticatedRequest): Promise<AssetResponseDto[]> {
    return this.assetService.getAssets(request.auth);
  }

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

  /**
   * Streams the asset's bytes for inline display (`<img src>` / `<video src>`).
   *
   * There is no derived thumbnail yet — the pipeline stage is a pass-through —
   * so this serves the original. It stays a separate route from `original` so a
   * real thumbnail stage can be slotted in later without an API change.
   */
  @Get(':id/thumbnail')
  @Authenticated()
  getThumbnail(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    return this.serveAssetFile(request, id, 'inline');
  }

  /**
   * Streams the full-size original. Marked `inline` so a browser renders it;
   * clients that want a download ask for it with the anchor's `download`
   * attribute instead of relying on a `Content-Disposition: attachment`.
   */
  @Get(':id/original')
  @Authenticated()
  getOriginal(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    return this.serveAssetFile(request, id, 'inline');
  }

  /** Shared tail of the two read routes: resolve the file, shape the headers. */
  private async serveAssetFile(
    request: AuthenticatedRequest,
    id: string,
    disposition: 'inline' | 'attachment',
  ): Promise<StreamableFile> {
    const file = await this.assetService.getAssetMediaFile(request.auth, id);

    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}
