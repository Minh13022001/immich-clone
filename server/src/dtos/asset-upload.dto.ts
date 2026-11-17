import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AssetMediaStatus, AssetVisibility, AssetMetadataItemDto } from './asset-media.dto';

/**
 * Direct-to-storage upload contract.
 *
 * The client never names a bucket, a key or a prefix: it declares *what* it is
 * about to send (name, size, digest, metadata) and the server decides *where*
 * the bytes go. Everything the asset row needs is validated here, once, at
 * initiate time; `/complete` then only proves the bytes arrived.
 */

/** JSON bodies carry real numbers, but a form-encoded client may send strings. */
function toNumber(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return typeof value === 'number' ? value : Number(value);
}

/** Same idea as `toNumber`, for the boolean fields. */
function toBoolean(value: unknown): unknown {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return value;
}

/** Body of `POST /assets/uploads` — the initiate step. */
export class InitiateAssetUploadDto {
  /** Original name, extension included; drives the type check and the key suffix. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  /** Exact byte count the client promises to upload. */
  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(1)
  fileSize!: number;

  /** Declared MIME type; derived from the filename when omitted. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contentType?: string;

  /** SHA-1 of the whole file, hex or base64 (same codec as `bulk-upload-check`). */
  @IsString()
  @IsNotEmpty()
  checksum!: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssetMetadataItemDto)
  metadata?: AssetMetadataItemDto[];
}

/** One part the client wants a presigned URL for. */
export class AssetUploadPartRequestDto {
  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(1)
  partNumber!: number;

  /**
   * Optional SHA-1 of this part. When present it is signed into the URL, so S3
   * rejects a corrupted part immediately instead of at assembly time.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  checksum?: string;
}

/** Body of `POST /assets/uploads/:id/parts`. */
export class RequestAssetUploadPartsDto {
  /** Capped so one request cannot mint thousands of URLs. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssetUploadPartRequestDto)
  parts!: AssetUploadPartRequestDto[];
}

/** One completed part, as the browser saw it. */
export class CompleteAssetUploadPartDto {
  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(1)
  partNumber!: number;

  @IsString()
  @IsNotEmpty()
  etag!: string;
}

/**
 * Body of `POST /assets/uploads/:id/complete`.
 *
 * The part list is advisory: `ListParts` is authoritative, and these entries are
 * only cross-checked against it. A client cannot complete a session by inventing
 * parts it never uploaded.
 */
export class CompleteAssetUploadDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteAssetUploadPartDto)
  parts?: CompleteAssetUploadPartDto[];
}

/** `201` body of the initiate step (or `200` when the bytes already exist). */
export interface AssetUploadInitiateResponseDto {
  /** Id used by `/parts`, `/complete` and `/abort`. Empty when `status` is duplicate. */
  uploadId: string;
  /** Server-chosen object key; informational, never accepted back as input. */
  key: string;
  /** `duplicate` means "do not upload"; the bytes are already on the server. */
  status: 'upload' | 'duplicate';
  /** Set when `status` is `duplicate`. */
  assetId?: string;
  multipart: boolean;
  /** Size of a full part (and of the single-part budget when not multipart). */
  partSize: number;
  /** `ceil(fileSize / partSize)`; always 1 for single-part uploads. */
  partCount: number;
  /** Present only for single-part uploads. */
  url?: string;
  method?: 'PUT';
  /** Headers that are part of the signature and must be sent verbatim. */
  headers?: Record<string, string>;
  expiresAt?: string;
}

/** One presigned part URL. */
export interface AssetUploadPresignedPartDto {
  partNumber: number;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** `200` body of `POST /assets/uploads/:id/parts`. */
export interface AssetUploadPartsResponseDto {
  parts: AssetUploadPresignedPartDto[];
  expiresAt: string;
}

/** `201`/`200` body of `/complete`; identical shape to the legacy `POST /assets`. */
export interface AssetUploadCompleteResponseDto {
  id: string;
  status: AssetMediaStatus;
}
