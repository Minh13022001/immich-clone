<script lang="ts">
  import { AssetType, type Asset } from '@immich/sdk';

  import { assetOriginalUrl } from '$lib/services';

  interface Props {
    /** The asset to show, or `null` to keep the overlay closed. */
    asset: Asset | null;
    onClose: () => void;
  }

  let { asset, onClose }: Props = $props();

  let dialog = $state<HTMLDivElement | null>(null);

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && asset) {
      onClose();
    }
  }

  /**
   * A modal dialog must own the focus while it is open, otherwise keyboard and
   * screen-reader users keep interacting with the page behind the overlay. Move
   * focus into the dialog on open and hand it back to the opener on close.
   */
  $effect(() => {
    if (!asset) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if asset}
  <div
    class="fixed inset-0 z-50 flex flex-col gap-3 bg-black/85 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={asset.originalFileName}
    tabindex="-1"
    bind:this={dialog}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="Close viewer"
      tabindex="-1"
      onclick={onClose}
    ></button>
    <div class="relative flex items-center justify-between gap-3">
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

    <!-- Not positioned on purpose: the absolutely positioned backdrop button
         paints over this empty area, so clicking beside the media dismisses the
         viewer, while the relatively positioned media stays clickable. -->
    <div class="flex min-h-0 flex-1 items-center justify-center">
      {#if asset.type === AssetType.VIDEO}
        <video
          class="relative max-h-full max-w-full rounded-lg"
          src={assetOriginalUrl(asset.id)}
          controls
          playsinline
        >
          <track kind="captions" />
        </video>
      {:else}
        <img
          class="relative max-h-full max-w-full rounded-lg object-contain"
          src={assetOriginalUrl(asset.id)}
          alt={asset.originalFileName}
        />
      {/if}
    </div>
  </div>
{/if}
