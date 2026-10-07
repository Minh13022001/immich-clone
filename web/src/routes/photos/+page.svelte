<script lang="ts">
  import type { Asset } from '@immich/sdk';

  import AssetThumbnail from '$lib/components/asset-thumbnail.svelte';
  import AssetViewer from '$lib/components/asset-viewer.svelte';
  import { libraryManager } from '$lib/managers/library-manager.svelte';

  /** The asset whose full-size view is open, or `null` when the viewer is shut. */
  let selected = $state<Asset | null>(null);

  const isEmpty = $derived(!libraryManager.loading && libraryManager.assets.length === 0);
</script>

<section>
  <div class="mb-4 flex items-end justify-between gap-3">
    <div>
      <h2 class="text-lg font-semibold">Photos</h2>
      <p class="mt-1 text-sm text-muted">Everything uploaded to this instance, newest first.</p>
    </div>

    <button
      type="button"
      class="btn btn-secondary shrink-0"
      onclick={() => void libraryManager.load()}
      disabled={libraryManager.loading}
    >
      {libraryManager.loading ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>

  {#if libraryManager.error}
    <p class="mb-4 text-danger" role="alert">{libraryManager.error}</p>
  {/if}

  {#if libraryManager.loading && libraryManager.assets.length === 0}
    <p class="text-sm text-muted">Loading…</p>
  {:else if isEmpty}
    <p class="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
      Nothing has been uploaded yet.
    </p>
  {:else}
    <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      {#each libraryManager.assets as asset (asset.id)}
        <li>
          <AssetThumbnail
            {asset}
            onOpen={(value) => (selected = value)}
            class="aspect-square w-full"
          />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<AssetViewer asset={selected} onClose={() => (selected = null)} />
