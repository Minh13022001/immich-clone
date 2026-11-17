import type { StorageBackend } from '../repositories/object-storage.repository';

/**
 * What a client may assume about direct uploads (brief §4).
 *
 * The uploader reads this once so it never hardcodes a ceiling the server would
 * then reject, and so the "single PUT or multipart?" decision is made with the
 * server's own numbers rather than the client's guess.
 */
export interface StorageCapabilitiesDto {
  /** `local` = this API impersonates S3 via a signed PUT route; `s3` = real presigned URLs. */
  backend: StorageBackend;
  /** Largest byte count `/assets/uploads` will authorise. */
  maxUploadSize: number;
  /** Above this size the server requires the multipart flow (S3 only). */
  multipartThreshold: number;
  /** Fixed part size the server presigns part URLs for. */
  partSize: number;
  /** Whether the backend offers multipart at all. */
  multipart: boolean;
}

/**
 * Response shape of `GET /api/server-info`. The CLI prints this, which is the
 * cheapest way to prove a deployment is reachable.
 */
export interface ServerInfoDto {
  name: string;
  version: string;
  nodeVersion: string;
  storage: StorageCapabilitiesDto;
}

/**
 * Response shape of `GET /api/server-info/media-types` (spec §8.3).
 *
 * Mime types only: the web client converts them into the extensions its file
 * picker and drag-and-drop pre-filter should accept.
 */
export interface SupportedMediaTypesDto {
  image: string[];
  video: string[];
  sidecar: string[];
}
