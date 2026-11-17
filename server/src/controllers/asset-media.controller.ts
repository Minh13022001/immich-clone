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

import { Permission, firstHeaderValue, type AuthenticatedRequest } from '../authentication/context';
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
import { parseByteRange } from '../utils/http-range';

/**
 * HTTP surface for asset uploads (spec §5.1).
 *
 * The controller stays thin: interceptors materialise the binary parts, and all
 * persistence decisions live in `AssetMediaService`. Its only real job is
 * choosing the status code — 201 for a new asset, 200 when the upload turned out
 * to be a duplicate.
 */
@Controller('assets') //1
export class AssetMediaController {
  private readonly fileNotEmpty = new FileNotEmptyValidator([UploadFieldName.ASSET_DATA]);

  constructor(private readonly assetService: AssetMediaService) {}

  @Get()
  @Authenticated()
  listAssets(@Req() request: AuthenticatedRequest): Promise<AssetResponseDto[]> {
    return this.assetService.getAssets(request.auth);
  }

  @Post() //2
  @Authenticated({ permission: Permission.AssetUpload }) // must be logged in AND have the AssetUpload permission
  @UseInterceptors(AssetUploadInterceptor, FileUploadInterceptor) // run left to right: checksum check first, file parsing second
  @UploadRoute(RouteKey.Asset) // tells FileUploadInterceptor which fields to accept (assetData)
  async uploadAsset(
    @Req() request: AuthenticatedRequest, // the request, with `auth` = who is calling
    @Body() dto: CreateAssetDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AssetMediaResponseDto> {
    this.fileNotEmpty.validate(request);

    const file = getUploadedFile(request, UploadFieldName.ASSET_DATA);

    if (!file) {
      // no main file means there is nothing to save
      // `fileNotEmpty` already threw, so this only satisfies the type checker.
      throw new Error('Asset part was not parsed'); // unreachable at runtime; just narrows `file` to non-undefined
    }

    const result = await this.assetService.uploadAsset(request.auth, dto, file); // real work (save file, DB rows) lives in the service

    if (result.status === AssetMediaStatus.DUPLICATE) {
      // duplicate = nothing new was created
      response.status(HttpStatus.OK); // so answer 200 instead of Nest's default 201
    }

    return result; // send it as the JSON body (201 for new, 200 for duplicate)
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.serveAssetFile(request, response, id, 'inline');
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.serveAssetFile(request, response, id, 'inline');
  }

  /**
   * Shared tail of the two read routes: resolve the file, shape the headers.
   *
   * `Range` is honoured so a `<video>` can seek. The service clamps the window
   * to the real object and reports the served slice through `contentRange`,
   * which is what distinguishes a `206` from a full `200`.
   */
  private async serveAssetFile(
    request: AuthenticatedRequest,
    response: Response,
    id: string,
    disposition: 'inline' | 'attachment',
  ): Promise<StreamableFile> {
    const range = parseByteRange(firstHeaderValue(request.headers.range));

    // Only pass the third argument when a range was actually requested: callers
    // (and the tests) rely on the plain two-argument call for a full response.
    const file = range
      ? await this.assetService.getAssetMediaFile(request.auth, id, range)
      : await this.assetService.getAssetMediaFile(request.auth, id);

    response.setHeader('Accept-Ranges', 'bytes');

    if (file.contentRange) {
      response.setHeader('Content-Range', file.contentRange);
      response.status(HttpStatus.PARTIAL_CONTENT);
    }

    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}
