import { request } from './fetch-client';
import type { ServerInfo } from './types';

/** Cheapest way for a client to prove the API is reachable. */
export function getServerInfo(): Promise<ServerInfo> {
  return request<ServerInfo>('/server-info');
}
