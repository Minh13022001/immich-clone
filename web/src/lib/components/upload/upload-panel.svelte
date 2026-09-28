<script lang="ts">
  import { uploadManager } from '$lib/managers/upload-manager.svelte';
  import { toastStore } from '$lib/stores/toast.store.svelte';

  import UploadPreviewRow from './upload-preview-row.svelte';

  /** Local UI state only; everything else lives in the store/manager. */
  let minimized = $state(false);

  const visible = $derived(uploadManager.items.length > 0);

  const aggregate = $derived.by(() => {
    let totalBytes = 0;
    let loadedBytes = 0;

    for (const item of uploadManager.items) {
      totalBytes += item.file.size;
      loadedBytes += (item.file.size * (item.progress ?? 0)) / 100;
    }

    return {
      percent: totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
    };
  });

  const summary = $derived.by(() => {
    if (uploadManager.isUploading) {
      const settled = uploadManager.success + uploadManager.errors + uploadManager.duplicates;
      return `${settled} of ${uploadManager.total} · ${uploadManager.remainingUploads} remaining`;
    }

    const parts: string[] = [];

    if (uploadManager.success > 0) {
      parts.push(`${uploadManager.success} uploaded`);
    }

    if (uploadManager.duplicates > 0) {
      parts.push(`${uploadManager.duplicates} duplicate`);
    }

    if (uploadManager.errors > 0) {
      parts.push(`${uploadManager.errors} failed`);
    }

    return parts.join(' · ') || 'Done';
  });

  // ---- Screen wake lock: hold the display awake only while work is in flight.
  interface WakeLockLike {
    release(): Promise<void>;
  }

  let wakeLock: WakeLockLike | null = null;

  async function acquireWakeLock(): Promise<void> {
    const api = (
      navigator as Navigator & {
        wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> };
      }
    ).wakeLock;

    if (!api || wakeLock) {
      return;
    }

    try {
      wakeLock = await api.request('screen');
    } catch {
      // Denied (battery saver, permissions) — uploads are unaffected.
      wakeLock = null;
    }
  }

  async function releaseWakeLock(): Promise<void> {
    const lock = wakeLock;
    wakeLock = null;

    try {
      await lock?.release();
    } catch {
      // Already released by the browser (e.g. tab hidden).
    }
  }

  // Reads only `isUploading`, so progress ticks do not re-acquire the lock.
  $effect(() => {
    if (!uploadManager.isUploading) {
      return;
    }

    void acquireWakeLock();

    return () => {
      void releaseWakeLock();
    };
  });

  // ---- Outro: one summary toast per non-zero category, on the settle edge.
  let hadWork = false;

  $effect(() => {
    if (uploadManager.isUploading) {
      hadWork = true;
      return;
    }

    if (!hadWork) {
      return;
    }

    hadWork = false;

    const { success, duplicates, errors } = uploadManager;

    if (success > 0) {
      toastStore.show('primary', `${success} upload${success === 1 ? '' : 's'} complete`);
    }

    if (duplicates > 0) {
      toastStore.show('warning', `${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped`);
    }

    if (errors > 0) {
      toastStore.show('danger', `${errors} upload${errors === 1 ? '' : 's'} failed`);
    }
  });

  // ---- Reset once nothing is left to show, so the next session starts at zero.
  $effect(() => {
    if (uploadManager.isUploading || uploadManager.items.length > 0) {
      return;
    }

    const settled =
      uploadManager.total + uploadManager.success + uploadManager.errors + uploadManager.duplicates;

    if (settled > 0) {
      uploadManager.reset();
    }
  });
</script>

{#if visible}
  <section
    class="fixed right-4 bottom-4 z-40 w-[min(420px,92vw)] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
    aria-label="Upload progress"
  >
    <header class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold">
          {uploadManager.isUploading ? 'Uploading' : 'Uploads'}
        </p>
        <p class="truncate text-xs text-muted">{summary}</p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <label class="flex items-center gap-1.5 text-xs text-muted">
          <span class="sr-only">Parallel uploads</span>
          <input
            class="input w-14 flex-none px-1.5 py-1 text-center"
            type="number"
            min="1"
            max="50"
            value={uploadManager.concurrency}
            onchange={(event) => uploadManager.setConcurrencyFromEvent(event)}
          />
        </label>

        <button
          type="button"
          class="cursor-pointer text-xs text-muted transition-colors hover:text-foreground"
          aria-expanded={!minimized}
          onclick={() => (minimized = !minimized)}
        >
          {minimized ? 'Expand' : 'Minimize'}
        </button>
      </div>
    </header>

    {#if !minimized}
      <ul class="max-h-64 divide-y divide-border overflow-y-auto">
        {#each uploadManager.items as item (item.id)}
          <UploadPreviewRow
            {item}
            onRetry={(id) => void uploadManager.retry(id)}
            onDismiss={(id) => uploadManager.removeItem(id)}
          />
        {/each}
      </ul>

      <footer class="flex items-center gap-3 border-t border-border px-3 py-2">
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-200"
            style="width: {aggregate.percent}%"
          ></div>
        </div>

        {#if uploadManager.isDismissible}
          <button
            type="button"
            class="btn btn-secondary px-2 py-1 text-xs"
            onclick={() => uploadManager.dismissErrors()}
          >
            Dismiss failed
          </button>
        {/if}
      </footer>
    {/if}
  </section>
{/if}
