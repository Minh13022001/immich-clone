/**
 * Response shape of `GET /api/server-info`. The CLI prints this, which is the
 * cheapest way to prove a deployment is reachable.
 */
export interface ServerInfoDto {
  name: string;
  version: string;
  nodeVersion: string;
}
