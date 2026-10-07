import type { Asset } from '@immich/sdk';

/**
 * The full collection of assets the server reports for the current user.
 *
 * Unlike `timelineStore` (a bounded feed of live upload events), this store
 * holds the authoritative list fetched from `GET /assets`, so it is what the
 * library page renders. A rune-backed store: any component reading these fields
 * re-renders when they change.
 */
class AssetsStore {
  assets = $state<Asset[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  set(assets: Asset[]): void {
    this.assets = assets;
  }
}

export const assetsStore = new AssetsStore();
