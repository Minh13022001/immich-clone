import type { ServerInfo } from '@immich/sdk';

class ServerInfoStore {
  info = $state<ServerInfo | null>(null);
  error = $state<string | null>(null);
}

export const serverInfoStore = new ServerInfoStore();
