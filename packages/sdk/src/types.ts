/**
 * Wire types shared by every SDK consumer.
 *
 * These mirror the API's JSON, not the server's internal types: timestamps
 * arrive as ISO strings over HTTP, so the SDK does not pretend they are `Date`.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/** Where the bytes live; mirrors the server's `STORAGE_BACKEND`. */
export type StorageBackend = 'local' | 's3';

/**
 * Limits and flow the server imposes on direct uploads (brief §4).
 *
 * The uploader reads these once instead of hardcoding a ceiling the server would
 * reject, and decides single-PUT vs multipart from the server's numbers.
 */
export interface StorageCapabilities {
  backend: StorageBackend;
  maxUploadSize: number;
  multipartThreshold: number;
  partSize: number;
  multipart: boolean;
}

export interface ServerInfo {
  name: string;
  version: string;
  nodeVersion: string;
  storage: StorageCapabilities;
}

/** Multipart field names for `POST /assets` (spec §3.1). */
export enum UploadFieldName {
  ASSET_DATA = 'assetData',
  PROFILE_DATA = 'file',
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

/** Asset kind; derived server-side from the uploaded file's extension (§3.4). */
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

/** One `{ key, value }` pair of user-supplied metadata. */
export interface AssetMetadataItem {
  key: string;
  value: string;
  value2?: string;
}

/**
 * Body fields of the multipart upload. The binary parts are appended to
 * `FormData` by the caller; everything here travels as a string field.
 */
export interface CreateAssetRequest {
  fileCreatedAt: string;
  fileModifiedAt: string;
  duration?: number;
  filename?: string;
  isFavorite?: boolean;
  visibility?: AssetVisibility;
  livePhotoVideoId?: string;
  metadata?: AssetMetadataItem[];
}

/** The asset projection returned by the API and pushed over SSE (§7). */
export interface Asset {
  id: string;
  ownerId: string;
  type: string;
  originalFileName: string;
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

/** `201`/`200` body of `POST /assets`. */
export interface AssetMediaResponse {
  status: AssetMediaStatus;
  id: string;
}

/** One checksum the client wants the server to pre-check (§4.2). */
export interface BulkUploadCheckItem {
  /** Client-side identifier, echoed back in the matching result. */
  id: string;
  /** SHA-1 as hex or base64; decoded length decides which (§4.2). */
  checksum: string;
}

/** One entry of the bulk pre-check response. */
export interface BulkUploadCheckResult {
  id: string;
  action: AssetUploadAction;
  reason?: AssetRejectReason;
  assetId?: string;
  isTrashed?: boolean;
}

/** `200` body of `POST /assets/bulk-upload-check`. */
export interface BulkUploadCheckResponse {
  results: BulkUploadCheckResult[];
}

/** Mime types the server accepts, grouped for file-picker filters (§8.3). */
export interface SupportedMediaTypes {
  image: string[];
  video: string[];
  sidecar: string[];
}

/** The SSE event pushed when an upload is ready for the timeline (§7). */
export interface AssetUploadReadyEvent {
  asset: Asset;
  exif: Record<string, unknown> | null;
}

/**
 * Direct-to-storage upload contract (`POST /assets/uploads`).
 *
 * The client declares *what* it is about to send and the server decides *where*
 * the bytes go, so no bucket, prefix or key ever travels from client to server.
 */
export interface InitiateAssetUploadRequest {
  /** Original name, extension included; drives the type check and the key suffix. */
  filename: string;
  /** Exact byte count the client promises to upload. */
  fileSize: number;
  /** Declared MIME type; derived from the filename when omitted. */
  contentType?: string;
  /** SHA-1 of the whole file, hex or base64 (same codec as `bulk-upload-check`). */
  checksum: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  duration?: number;
  isFavorite?: boolean;
  visibility?: AssetVisibility;
  livePhotoVideoId?: string;
  metadata?: AssetMetadataItem[];
}

/**
 * `201` body of the initiate step (or `200` when the bytes already exist).
 *
 * When `status` is `duplicate` there is nothing to upload: `uploadId` is empty
 * and `assetId` points at the asset that already holds these bytes.
 */
export interface AssetUploadInitiateResponse {
  uploadId: string;
  /** Server-chosen object key; informational, never accepted back as input. */
  key: string;
  status: 'upload' | 'duplicate';
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

/** One part the client wants a presigned URL for. */
export interface AssetUploadPartRequest {
  partNumber: number;
  /**
   * Optional SHA-1 of this part. When present it is signed into the URL, so the
   * store rejects a corrupted part immediately instead of at assembly time.
   */
  checksum?: string;
}

/** One presigned part URL. */
export interface AssetUploadPresignedPart {
  partNumber: number;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** `200` body of `POST /assets/uploads/:id/parts`. */
export interface AssetUploadPartsResponse {
  parts: AssetUploadPresignedPart[];
  expiresAt: string;
}

/** One completed part, as the browser observed it in the `ETag` header. */
export interface CompletedAssetUploadPart {
  partNumber: number;
  etag: string;
}

/**
 * Body of `POST /assets/uploads/:id/complete`.
 *
 * The part list is advisory: the server re-reads the store's own part listing,
 * so a client cannot complete a session by inventing parts it never uploaded.
 */
export interface CompleteAssetUploadRequest {
  parts?: CompletedAssetUploadPart[];
}

/** `201`/`200` body of `/complete`; same shape as the legacy `POST /assets`. */
export interface AssetUploadCompleteResponse {
  id: string;
  status: AssetMediaStatus;
}
