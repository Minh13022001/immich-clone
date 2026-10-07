<script lang="ts">
  import { AssetType, type Asset } from '@immich/sdk';

  import { assetThumbnailUrl } from '$lib/services';

  interface Props {
    asset: Asset;
    onOpen: (asset: Asset) => void;
    /** Layout classes; defaults to the compact list-row thumbnail size. */
    class?: string;
  }

  let { asset, onOpen, class: className = 'aspect-square w-16' }: Props = $props();

  /** Flipped by the image's `error` event when the server cannot serve the bytes. */
  let failed = $state(false);

  // The thumbnail route currently serves the original, so a video's first frame
  // may not paint in every browser; the badge keeps the kind obvious regardless.
  const isVideo = $derived(asset.type === AssetType.VIDEO);
</script>

<button
  type="button"
  class="group relative grid {className} shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md border border-border bg-background"
  aria-label="View {asset.originalFileName}"
  onclick={() => onOpen(asset)}
>
  {#if failed}
    <svg
      class="h-6 w-6 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m3 15 5-5 4 4 3-3 6 6" />
      <circle cx="9" cy="9" r="1.2" />
    </svg>
  {:else}
    <img
      class="h-full w-full object-cover transition group-hover:opacity-80"
      src={assetThumbnailUrl(asset.id)}
      alt=""
      loading="lazy"
      decoding="async"
      onerror={() => (failed = true)}
    />
  {/if}

  {#if isVideo}
    <span
      class="pointer-events-none absolute right-1 bottom-1 grid h-5 w-5 place-items-center rounded-full bg-black/65 text-white"
      aria-hidden="true"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  {/if}
</button>
