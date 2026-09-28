import type { Asset } from '@immich/sdk';

/** Bounded so a long-lived tab cannot grow without limit. */
const MAX_ASSETS = 24;

/**
 * Newest-first list of assets the server has finished processing.
 *
 * The reference injects these straight into its timeline stores over the
 * websocket; this clone keeps a small bounded feed instead, which the upload
 * page renders as "recently processed" (spec §8.6, D6).
 */
class TimelineStore {
  assets = $state<Asset[]>([]);

  add(asset: Asset): void {
    this.assets = [asset, ...this.assets.filter((existing) => existing.id !== asset.id)].slice(
      0,
      MAX_ASSETS,
    );
  }

  reset(): void {
    this.assets = [];
  }
}

export const timelineStore = new TimelineStore();
