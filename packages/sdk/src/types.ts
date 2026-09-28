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

export interface ServerInfo {
  name: string;
  version: string;
  nodeVersion: string;
}

/** Multipart field names for `POST /assets` (spec §3.1). */
export enum UploadFieldName {
  ASSET_DATA = 'assetData',
  SIDECAR_DATA = 'sidecarData',
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
