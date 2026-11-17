import type { ColumnType, Generated } from 'kysely';

/**
 * Lifecycle of a direct (presigned) upload.
 *
 * `pending`   — a session was created and a URL handed out, nothing arrived yet.
 * `uploading` — the client reported progress / asked for more part URLs.
 * `verifying` — `/complete` is running `HeadObject` + digest verification.
 * `completed` — the asset row exists; `assetId` points at it.
 * `duplicate` — bytes matched an existing asset; the object was discarded.
 * `aborted`   — the client cancelled, or the object never arrived.
 * `expired`   — the sweeper reclaimed an abandoned session.
 * `failed`    — verification rejected the object (size/type/digest mismatch).
 */
export type AssetUploadStatus =
  | 'pending'
  | 'uploading'
  | 'verifying'
  | 'completed'
  | 'duplicate'
  | 'aborted'
  | 'expired'
  | 'failed';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type JsonColumn<T> = ColumnType<T, string | T | undefined, string | T>;
type NullableString = ColumnType<string | null, string | null | undefined, string | null>;

/**
 * Everything `/complete` needs to build the asset row, frozen at initiate time.
 *
 * Snapshotting it here is what makes completion idempotent: a retried `/complete`
 * (or a request from a second tab) never depends on the client re-sending the
 * metadata, and a client cannot change `visibility` or timestamps between the
 * presign and the finalize.
 */
export interface AssetUploadSnapshot {
  filename: string;
  originalFileName: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  isFavorite?: boolean;
  visibility?: string;
  livePhotoVideoId?: string | null;
  duration?: number | null;
  metadata?: { key: string; value: string }[];
}

/** One uploaded multipart part, as reported back by S3 (`ListParts`). */
export interface StoredUploadPart {
  partNumber: number;
  etag: string;
  size: number;
}

/**
 * A pending upload session.
 *
 * `(ownerId, checksum)` is protected by the `ASSET_UPLOAD_ACTIVE_CHECKSUM`
 * partial unique index for every non-terminal status, so retries and concurrent
 * uploads of the same bytes converge on a single session.
 */
export interface AssetUploadTable {
  id: Generated<string>;
  ownerId: string;
  status: Generated<AssetUploadStatus>;
  checksum: Buffer;
  checksumAlgorithm: Generated<string>;
  declaredSize: number;
  declaredContentType: string | null;
  assetId: ColumnType<string | null, string | null | undefined, string | null>;
  bucket: string;
  storageKey: string;
  multipartUploadId: ColumnType<string | null, string | null | undefined, string | null>;
  partSize: ColumnType<number | null, number | null | undefined, number | null>;
  parts: JsonColumn<StoredUploadPart[]>;
  dto: JsonColumn<AssetUploadSnapshot>;
  reservedBytes: Generated<number>;
  attempts: Generated<number>;
  error: NullableString;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
