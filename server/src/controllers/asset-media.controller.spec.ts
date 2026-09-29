import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../authentication/context';
import {
  AssetMediaStatus,
  UploadFieldName,
  type BulkUploadCheckDto,
  type CreateAssetDto,
} from '../dtos/asset-media.dto';
import { AssetMediaService } from '../services/asset-media.service';
import { AssetMediaController } from './asset-media.controller';

/**
 * Controller-level contract (spec §5.1, §10): the *only* decision the controller
 * makes is the status code, so 201-vs-200 is asserted directly on the response
 * object rather than through a live HTTP round trip.
 */
function createHarness(result: { id: string; status: AssetMediaStatus }) {
  const assetService = {
    uploadAsset: vi.fn().mockResolvedValue(result),
    bulkUploadCheck: vi.fn().mockResolvedValue({ results: [] }),
    getAssetMediaFile: vi.fn(),
  };
  const controller = new AssetMediaController(assetService as unknown as AssetMediaService);

  const response = { status: vi.fn().mockReturnThis() };
  const request = {
    auth: { user: { id: 'user-1' }, sharedLink: null },
    files: {
      [UploadFieldName.ASSET_DATA]: [
        {
          fieldname: UploadFieldName.ASSET_DATA,
          originalname: 'photo.jpg',
          size: 4096,
          path: '/media/upload/user-1/ab/cd/uuid.jpg',
          uuid: 'abcd1234-0000-4000-8000-000000000000',
        },
      ],
    },
  };

  return { controller, assetService, response, request };
}

describe('AssetMediaController', () => {
  it('leaves the default 201 in place for a newly created asset', async () => {
    const { controller, response, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.CREATED,
    });

    const result = await controller.uploadAsset(
      request as unknown as AuthenticatedRequest,
      {} as CreateAssetDto,
      response as unknown as Response,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'asset-1', status: AssetMediaStatus.CREATED });
  });

  it('rewrites the status to 200 when the upload was a duplicate', async () => {
    const { controller, response, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.DUPLICATE,
    });

    const result = await controller.uploadAsset(
      request as unknown as AuthenticatedRequest,
      {} as CreateAssetDto,
      response as unknown as Response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(result).toEqual({ id: 'asset-1', status: AssetMediaStatus.DUPLICATE });
  });

  it('rejects an empty asset part with 400 File is empty before calling the service', async () => {
    const { controller, assetService, response, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.CREATED,
    });
    request.files[UploadFieldName.ASSET_DATA][0]!.size = 0;

    await expect(
      controller.uploadAsset(
        request as unknown as AuthenticatedRequest,
        {} as CreateAssetDto,
        response as unknown as Response,
      ),
    ).rejects.toThrowError(new BadRequestException('File is empty'));

    expect(assetService.uploadAsset).not.toHaveBeenCalled();
  });

  it('passes the parsed parts and the resolved identity to the service', async () => {
    const { controller, assetService, response, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.CREATED,
    });
    const dto = { fileCreatedAt: '2024-01-01T00:00:00.000Z' } as CreateAssetDto;

    await controller.uploadAsset(
      request as unknown as AuthenticatedRequest,
      dto,
      response as unknown as Response,
    );

    const [, passedDto, file, sidecar] = assetService.uploadAsset.mock.calls[0] as unknown as [
      unknown,
      CreateAssetDto,
      { uuid: string },
      unknown,
    ];

    expect(passedDto).toBe(dto);
    expect(file.uuid).toBe('abcd1234-0000-4000-8000-000000000000');
    expect(sidecar).toBeUndefined();
  });

  it('delegates the bulk pre-check unchanged', async () => {
    const { controller, assetService, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.CREATED,
    });
    const dto = { assets: [{ id: 'client-1', checksum: 'a'.repeat(40) }] } as BulkUploadCheckDto;

    await expect(
      controller.bulkUploadCheck(request as unknown as AuthenticatedRequest, dto),
    ).resolves.toEqual({ results: [] });

    expect(assetService.bulkUploadCheck).toHaveBeenCalledWith(request.auth, dto);
  });

  it('streams an asset as an inline file with the resolved type and length', async () => {
    const { controller, assetService, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.CREATED,
    });
    const stream = Readable.from(['bytes']);
    assetService.getAssetMediaFile.mockResolvedValue({
      stream,
      mimeType: 'image/jpeg',
      fileName: 'photo final.jpg',
      size: 5,
    });
    const id = 'abcd1234-0000-4000-8000-000000000000';

    const file = await controller.getOriginal(request as unknown as AuthenticatedRequest, id);

    expect(assetService.getAssetMediaFile).toHaveBeenCalledWith(request.auth, id);
    expect(file.getStream()).toBe(stream);
    expect(file.getHeaders()).toEqual({
      type: 'image/jpeg',
      disposition: "inline; filename*=UTF-8''photo%20final.jpg",
      length: 5,
    });
  });

  it('serves the thumbnail through the same file resolution', async () => {
    const { controller, assetService, request } = createHarness({
      id: 'asset-1',
      status: AssetMediaStatus.CREATED,
    });
    assetService.getAssetMediaFile.mockResolvedValue({
      stream: Readable.from(['bytes']),
      mimeType: 'image/png',
      fileName: 'shot.png',
      size: 5,
    });
    const id = 'abcd1234-0000-4000-8000-000000000000';

    const file = await controller.getThumbnail(request as unknown as AuthenticatedRequest, id);

    expect(assetService.getAssetMediaFile).toHaveBeenCalledWith(request.auth, id);
    expect(file.getHeaders().type).toBe('image/png');
    expect(file.getHeaders().disposition).toBe("inline; filename*=UTF-8''shot.png");
  });
});
