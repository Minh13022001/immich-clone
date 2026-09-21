import { getServerInfo, type ServerInfo } from '@immich/sdk';

/** Used by the header badge to prove the API is reachable. */
export function fetchServerInfo(): Promise<ServerInfo> {
  return getServerInfo();
}
