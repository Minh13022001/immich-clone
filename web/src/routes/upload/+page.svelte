<script lang="ts">
  import { onMount } from 'svelte';

  import type { Asset } from '@immich/sdk';

  import AssetThumbnail from '$lib/components/asset-thumbnail.svelte';
  import AssetViewer from '$lib/components/asset-viewer.svelte';
  import UploadDropZone from '$lib/components/upload/upload-drop-zone.svelte';
  import { timelineManager } from '$lib/managers/timeline-manager.svelte';
  import { uploadManager } from '$lib/managers/upload-manager.svelte';
  import { formatTimestamp } from '$lib/utils';

  /** Native picker filter; empty until the server's list has loaded. */
  let accept = $state('');

  /** The asset whose full-size view is open, or `null` when the viewer is shut. */
  let selected = $state<Asset | null>(null);

  onMount(async () => {

    await uploadManager.loadMediaTypes();
    accept = uploadManager.extensions.map((extension) => `.${extension}`).join(',');
  });

  function startUpload(files: File[]): void {
    if (files.length === 0) {
      return;
    }

    void uploadManager.upload(files);
  }

  function onPick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;

    startUpload(Array.from(input.files ?? []));
    // Reset so picking the same file twice still fires `change`.
    input.value = '';
  }
</script>

<section>
  <div class="mb-6">
    <h2 class="text-lg font-semibold">Upload</h2>
    <p class="mt-1 text-sm text-muted">
      Add photos and videos to this instance. Uploads are hashed, de-duplicated and processed in the
      background.
    </p>
  </div>

  <UploadDropZone onFiles={startUpload}>
    <p class="text-sm font-medium">Drag & drop files or folders here</p>
    <p class="text-xs text-muted">or paste an image from the clipboard</p>

    <label class="btn mt-2">
      Select files
      <input class="sr-only" type="file" multiple {accept} onchange={onPick} />
    </label>
  </UploadDropZone>

  <div class="mt-6">
    <div class="mb-3 flex items-center justify-between gap-3">
      <p class="text-sm font-semibold">Recently processed</p>
      <p class="text-xs text-muted">Live from the server event stream</p>
    </div>

    {#if timelineManager.assets.length === 0}
      <p class="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        Nothing processed yet in this session.
      </p>
    {:else}
      <ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {#each timelineManager.assets as asset (asset.id)}
          <li class="flex items-center gap-3 px-3 py-2">
            <AssetThumbnail {asset} onOpen={(value) => (selected = value)} />

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{asset.originalFileName}</p>
              <p class="truncate text-xs text-muted">
                {asset.type.toLowerCase()} · {formatTimestamp(asset.fileCreatedAt)}
              </p>
            </div>

            <span class="shrink-0 text-xs text-muted">{asset.visibility.toLowerCase()}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<AssetViewer asset={selected} onClose={() => (selected = null)} />
