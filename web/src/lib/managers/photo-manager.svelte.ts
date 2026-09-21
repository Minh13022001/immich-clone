import { addPhoto, listPhotos, removePhoto, renamePhoto } from '$lib/services/photos.service';
import { photosStore } from '$lib/stores/photos.store.svelte';
import { describeError } from '$lib/utils';

/**
 * The only place that mutates the photo store.
 *
 * Components read `photoManager.photos` and call the verbs below; the manager
 * decides what happens on success or failure. Errors become a message on the
 * store instead of exceptions, so no component needs a try/catch.
 */
class PhotoManager {
  readonly #store = photosStore;

  get photos() {
    return this.#store.photos;
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
      this.#store.set(await listPhotos());
    } catch (error) {
      this.#store.error = describeError(error);
    } finally {
      this.#store.loading = false;
    }
  }

  /** Returns `true` when the photo was created, so forms can clear themselves. */
  async create(name: string): Promise<boolean> {
    this.#store.error = null;

    try {
      this.#store.prepend(await addPhoto(name));

      return true;
    } catch (error) {
      this.#store.error = describeError(error);

      return false;
    }
  }

  async rename(id: string, name: string): Promise<boolean> {
    this.#store.error = null;

    try {
      this.#store.replace(await renamePhoto(id, name));

      return true;
    } catch (error) {
      this.#store.error = describeError(error);

      return false;
    }
  }

  async remove(id: string): Promise<void> {
    this.#store.error = null;

    try {
      await removePhoto(id);
      this.#store.remove(id);
    } catch (error) {
      this.#store.error = describeError(error);
    }
  }
}

export const photoManager = new PhotoManager();
