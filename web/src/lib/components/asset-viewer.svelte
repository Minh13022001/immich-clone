<script lang="ts">
  import { AssetType, type Asset } from '@immich/sdk';

  import { assetOriginalUrl } from '$lib/services';

  interface Props {
    /** The asset to show, or `null` to keep the overlay closed. */
    asset: Asset | null;
    onClose: () => void;
  }

  let { asset, onClose }: Props = $props();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && asset) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if asset}
  <div
    class="fixed inset-0 z-50 flex flex-col gap-3 bg-black/85 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={asset.originalFileName}
  >
    <div class="flex items-center justify-between gap-3">
      <p class="min-w-0 truncate text-sm font-medium text-foreground">{asset.originalFileName}</p>

      <div class="flex shrink-0 items-center gap-2">
        <!-- `rel="external"` tells the SvelteKit router to ignore this link: it is
             an API URL, and the browser should own the request so `download`
             works. It must render the response inline for the preview below. -->
        <a
          class="btn btn-secondary"
          href={assetOriginalUrl(asset.id)}
          download={asset.originalFileName}
          rel="external"
        >
          Download
        </a>
        <button type="button" class="btn btn-secondary" onclick={onClose}>Close</button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 items-center justify-center">
      {#if asset.type === AssetType.VIDEO}
        <video
          class="max-h-full max-w-full rounded-lg"
          src={assetOriginalUrl(asset.id)}
          controls
          playsinline
        >
          <track kind="captions" />
        </video>
      {:else}
        <img
          class="max-h-full max-w-full rounded-lg object-contain"
          src={assetOriginalUrl(asset.id)}
          alt={asset.originalFileName}
        />
      {/if}
    </div>
  </div>
{/if}
