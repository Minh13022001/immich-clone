/**
 * Response shape of `GET /api/server-info`. The CLI prints this, which is the
 * cheapest way to prove a deployment is reachable.
 */
export interface ServerInfoDto {
  name: string;
  version: string;
  nodeVersion: string;
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
