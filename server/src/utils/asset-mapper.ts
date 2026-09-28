import { AssetVisibility, type AssetResponseDto } from '../dtos/asset-media.dto';
import type { AssetRow } from '../schema';
import { fromChecksum } from './checksum';

/**
 * Row → DTO projection shared by the request path and the job pipeline.
 *
 * Both need the identical shape: `uploadAsset` embeds it in `AssetCreate`, and
 * the pipeline sends it as `on_upload_success` and inside `AssetUploadReadyV2`
 * (brief §7). Duplicating the mapping would let the two drift.
 */
export function toAssetResponse(row: AssetRow): AssetResponseDto {
  return {
    id: row.id,
    ownerId: row.ownerId,
    type: row.type,
    originalFileName: row.originalFileName,
    originalPath: row.originalPath,
    fileCreatedAt: row.fileCreatedAt.toISOString(),
    fileModifiedAt: row.fileModifiedAt.toISOString(),
    localDateTime: row.localDateTime.toISOString(),
    isFavorite: row.isFavorite,
    visibility: row.visibility as AssetVisibility,
    duration: row.duration === null ? null : String(row.duration),
    livePhotoVideoId: row.livePhotoVideoId,
    checksum: fromChecksum(row.checksum),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
