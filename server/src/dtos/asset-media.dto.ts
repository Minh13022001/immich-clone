import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Multipart field names (spec §3.1). `assetData` is the original binary,
 * `sidecarData` the optional `.xmp` companion, and `file` the profile-image part
 * that reuses the same streaming storage.
 */
export enum UploadFieldName {
  ASSET_DATA = 'assetData',
  SIDECAR_DATA = 'sidecarData',
  PROFILE_DATA = 'file',
}

/** `asset_file.type` values; only `Sidecar` is produced by an upload today. */
export enum AssetFileType {
  ORIGINAL = 'original',
  SIDECAR = 'sidecar',
}

/** Response discriminator for `POST /assets` (spec §3.2). */
export enum AssetMediaStatus {
  CREATED = 'created',
  DUPLICATE = 'duplicate',
}

/** Bulk pre-check verdict (spec §3.3). */
export enum AssetUploadAction {
  ACCEPT = 'accept',
  REJECT = 'reject',
}

/** Why the bulk pre-check rejected an item (spec §3.3). */
export enum AssetRejectReason {
  DUPLICATE = 'duplicate',
  UNSUPPORTED_FORMAT = 'unsupported-format',
}

/** Asset kind written to `asset.type`; derived from the uploaded file (§3.4). */
export enum AssetType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  OTHER = 'OTHER',
}

/** Where an asset is surfaced; only Timeline/Archive trigger upload events (§7). */
export enum AssetVisibility {
  TIMELINE = 'timeline',
  ARCHIVE = 'archive',
  LOCKED = 'locked',
}

/** Coerces a multipart string field into a number, passing empty values through. */
function toNumber(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return typeof value === 'number' ? value : Number(value);
}

/** Coerces the `'true'`/`'false'` strings multer produces into real booleans. */
function toBoolean(value: unknown): unknown {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return value;
}

/** Parses a JSON string field; malformed input is left for the validator to reject. */
function toJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** One `{ key, value }` pair of user-supplied metadata. */
export class AssetMetadataItemDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  value!: string;

  // The reference allows a third `value`-shaped field; nothing here reads it.
  @IsOptional()
  @IsString()
  value2?: string;
}

/**
 * Body of `POST /assets`.
 *
 * Every field arrives as a string when the request is `multipart/form-data`, so
 * the numeric/boolean/JSON fields are coerced here. The binary parts are handled
 * by multer and never reach the DTO body.
 */
export class CreateAssetDto {
  @IsISO8601()
  fileCreatedAt!: string;

  @IsISO8601()
  fileModifiedAt!: string;

  @IsOptional()
  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(0)
  duration?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  filename?: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsEnum(AssetVisibility)
  visibility?: AssetVisibility;

  @IsOptional()
  @IsUUID()
  livePhotoVideoId?: string;

  @IsOptional()
  @Transform(({ value }) => toJson(value))
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssetMetadataItemDto)
  metadata?: AssetMetadataItemDto[];
}

/** One checksum the client wants the server to pre-check (spec §4.2). */
export class BulkUploadCheckItemDto {
  /** Client-side identifier, echoed back in the matching result. */
  @IsString()
  @IsNotEmpty()
  id!: string;

  /** SHA-1 as hex or base64; decoded length decides which (§4.2). */
  @IsString()
  @IsNotEmpty()
  checksum!: string;
}

/** Body of `POST /assets/bulk-upload-check`. */
export class BulkUploadCheckDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUploadCheckItemDto)
  assets!: BulkUploadCheckItemDto[];
}

/** `201` body of `POST /assets`. */
export interface AssetMediaResponseDto {
  status: AssetMediaStatus;
  id: string;
}

/** One entry of the bulk pre-check response. */
export interface BulkUploadCheckResultDto {
  id: string;
  action: AssetUploadAction;
  reason?: AssetRejectReason;
  assetId?: string;
  isTrashed?: boolean;
}

/** `200` body of `POST /assets/bulk-upload-check`. */
export interface BulkUploadCheckResponseDto {
  results: BulkUploadCheckResultDto[];
}

/**
 * The asset projection emitted over SSE (`on_upload_success`) and embedded in
 * `AssetUploadReadyV2`. Deliberately small: the client only needs enough to
 * insert a placeholder row into the timeline until it refetches.
 */
export interface AssetResponseDto {
  id: string;
  ownerId: string;
  type: string;
  originalFileName: string;
  originalPath: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  localDateTime: string;
  isFavorite: boolean;
  visibility: AssetVisibility;
  duration: string | null;
  livePhotoVideoId: string | null;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

/** The SSE event the server pushes when an upload is ready for the timeline (§7). */
export interface AssetUploadReadyEventDto {
  asset: AssetResponseDto;
  exif: Record<string, unknown> | null;
}
