import { listAssets } from '$lib/services/assets.service';
import { assetsStore } from '$lib/stores/assets.store.svelte';
import { describeError } from '$lib/utils';

/**
 * The only place that mutates the assets store.
 *
 * Components read `libraryManager.assets` and call `load()`; the manager decides
 * what happens on success or failure. Errors become a message on the store
 * instead of exceptions, so no component needs a try/catch — the same contract
 * `userManager` follows.
 */
class LibraryManager {
  readonly #store = assetsStore;

  get assets() {
    return this.#store.assets;
  }

  get loading() {
    return this.#store.loading;
  }

  get error() {
    return this.#store.error;
  }

  async load(): Promise<void> {
    this.#store.loading = true;
    this.#store.error = null;

    try {
      this.#store.set(await listAssets());
    } catch (error) {
      this.#store.error = describeError(error);
    } finally {
      this.#store.loading = false;
    }
  }
}

export const libraryManager = new LibraryManager();
