import type { Asset, AssetUploadReadyEvent } from '@immich/sdk';

import { subscribeToServerEvents } from '$lib/services/events.service';
import { timelineStore } from '$lib/stores/timeline.store.svelte';

function isAsset(value: unknown): value is Asset {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    return false;
  }

  return typeof (value as { id: unknown }).id === 'string';
}

/**
 * Keeps the client's view of freshly processed assets in sync (spec §8.6).
 *
 * `on_upload_success` carries the finished asset; `AssetUploadReadyV2` repeats
 * it with its EXIF, so the two arrive as a pair for the same id and the store's
 * de-duplication collapses them into one entry. Connecting is idempotent.
 */
class TimelineManager {
  #unsubscribe?: () => void;

  get assets() {
    return timelineStore.assets;
  }

  connect(): void {
    if (this.#unsubscribe) {
      return;
    }

    this.#unsubscribe = subscribeToServerEvents({
      on_upload_success: (data) => {
        if (isAsset(data)) {
          timelineStore.add(data);
        }
      },
      AssetUploadReadyV2: (data) => {
        const event = data as Partial<AssetUploadReadyEvent> | null;

        if (event && isAsset(event.asset)) {
          timelineStore.add(event.asset);
        }
      },
    });
  }

  disconnect(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  reset(): void {
    timelineStore.reset();
  }
}

export const timelineManager = new TimelineManager();
