import { fetchServerInfo } from '$lib/services/server-info.service';
import { serverInfoStore } from '$lib/stores/server-info.store.svelte';
import { describeError } from '$lib/utils';

class ServerInfoManager {
  readonly #store = serverInfoStore;

  get info() {
    return this.#store.info;
  }

  get error() {
    return this.#store.error;
  }

  async load(): Promise<void> {
    try {
      this.#store.info = await fetchServerInfo();
      this.#store.error = null;
    } catch (error) {
      this.#store.error = describeError(error);
    }
  }
}

export const serverInfoManager = new ServerInfoManager();
