import { fetchSupportedMediaTypes } from '$lib/services/upload.service';
import { uploadStore } from '$lib/stores/upload.store.svelte';
import {
  fileUploader,
  fileUploadHandler,
  getExtensions,
  openFileUploadDialog,
  setConcurrency as applyConcurrency,
  setSupportedMediaTypes,
} from '$lib/utils/file-uploader';
import { cancelUploadRequests } from '$lib/utils/upload-request';

/**
 * The only place that drives the upload layer.
 *
 * Components read the store through these getters and call the verbs below.
 * The manager also owns the one piece of state that is not per-file: the
 * server's list of accepted media types, fetched once per session (§8.3).
 */
class UploadManager {
  readonly #store = uploadStore;
  #mediaTypesLoaded = false;

  get items() {
    return this.#store.items;
  }

  get total() {
    return this.#store.total;
  }

  get success() {
    return this.#store.success;
  }

  get errors() {
    return this.#store.errors;
  }

  get duplicates() {
    return this.#store.duplicates;
  }

  get concurrency() {
    return this.#store.concurrency;
  }

  get isUploading() {
    return this.#store.isUploading;
  }

  get remainingUploads() {
    return this.#store.remainingUploads;
  }

  get isDismissible() {
    return this.#store.isDismissible;
  }

  /** Extensions the file picker and drop filter accept. */
  get extensions() {
    return getExtensions();
  }

  /**
   * Learns what the server accepts. Failure is not fatal: an unknown list
   * accepts every file and lets the server reject the unsupported ones.
   */
  async loadMediaTypes(): Promise<void> {
    if (this.#mediaTypesLoaded) {
      return;
    }

    try {
      setSupportedMediaTypes(await fetchSupportedMediaTypes());
      this.#mediaTypesLoaded = true;
    } catch (error) {
      console.warn('[upload] Could not load supported media types', error);
    }
  }

  setConcurrency(value: number): void {
    const clamped = Math.min(50, Math.max(1, Math.round(value)));

    this.#store.concurrency = clamped;
    applyConcurrency(clamped);
  }

  setConcurrencyFromEvent(event: Event): void {
    const target = event.currentTarget;

    if (target instanceof HTMLInputElement) {
      this.setConcurrency(target.valueAsNumber);
    }
  }

  upload(
    files: File[],
    options: { albumId?: string; isLockedAssets?: boolean } = {},
  ): Promise<string[]> {
    return fileUploadHandler({ files, ...options });
  }

  pickAndUpload({
    albumId,
    multiple = true,
  }: { albumId?: string; multiple?: boolean } = {}): Promise<string[]> {
    return openFileUploadDialog({ albumId, multiple });
  }

  /**
   * Re-enqueues an item after a failure (spec §8.6). The store keeps the item
   * (it is no longer in flight), so only the upload itself is repeated.
   */
  retry(id: string): Promise<string | undefined> {
    const item = this.#store.items.find((existing) => existing.id === id);

    if (item === undefined) {
      return Promise.resolve(undefined);
    }

    this.#store.updateItem(id, { error: undefined, state: undefined });

    return fileUploader({
      assetFile: item.file,
      albumId: item.albumId,
      deviceAssetId: item.id,
    });
  }

  removeItem(id: string): boolean {
    return this.#store.removeItem(id);
  }

  dismissErrors(): void {
    this.#store.dismissErrors();
  }

  /** Ends the session: abort in-flight requests, then clear the panel. */
  reset(): void {
    cancelUploadRequests();
    this.#store.reset();
  }
}

export const uploadManager = new UploadManager();
