<script lang="ts">
  import { UploadState, type UploadItem } from '$lib/stores/upload.store.svelte';
  import { formatBytes, formatDuration, formatSpeed } from '$lib/utils';

  interface Props {
    item: UploadItem;
    onRetry: (id: string) => void;
    onDismiss: (id: string) => void;
  }

  let { item, onRetry, onDismiss }: Props = $props();

  const ICON_PATH: Record<UploadState, string> = {
    [UploadState.PENDING]: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
    [UploadState.STARTED]: 'M12 19V5m0 0-6 6m6-6 6 6',
    [UploadState.DONE]: 'M20 6 9 17l-5-5',
    [UploadState.ERROR]:
      'M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    [UploadState.DUPLICATED]:
      'M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  };

  const ICON_CLASS: Record<UploadState, string> = {
    [UploadState.PENDING]: 'text-muted',
    [UploadState.STARTED]: 'text-accent',
    [UploadState.DONE]: 'text-accent',
    [UploadState.ERROR]: 'text-danger',
    [UploadState.DUPLICATED]: 'text-warning',
  };

  // An item is only "in flight" between enqueue and settle; everything else can
  // be retried or dismissed (spec §8.6).
  const state = $derived(item.state ?? UploadState.PENDING);
  const inFlight = $derived(state === UploadState.PENDING || state === UploadState.STARTED);
  const canRetry = $derived(state === UploadState.ERROR || state === UploadState.DUPLICATED);

  const detail = $derived(buildDetail());

  function buildDetail(): string {
    switch (state) {
      case UploadState.ERROR: {
        return item.error ?? 'Upload failed';
      }
      case UploadState.DUPLICATED: {
        return item.isTrashed ? 'Already uploaded — in trash' : 'Already uploaded';
      }
      case UploadState.DONE: {
        return 'Uploaded';
      }
      case UploadState.STARTED: {
        return describeProgress();
      }
      default: {
        return 'Waiting…';
      }
    }
  }

  function describeProgress(): string {
    const parts: string[] = [];

    if (item.progress !== undefined) {
      parts.push(`${item.progress}%`);
    }

    if (item.speed !== undefined && item.speed > 0) {
      parts.push(formatSpeed(item.speed));
    }

    if (item.eta !== undefined) {
      parts.push(`${formatDuration(item.eta)} left`);
    }

    return parts.join(' · ') || 'Starting…';
  }
</script>

<li class="flex items-start gap-3 px-3 py-2">
  <svg
    class="mt-0.5 h-4 w-4 shrink-0 {ICON_CLASS[state]}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={ICON_PATH[state]} />
  </svg>

  <div class="min-w-0 flex-1">
    <p class="truncate text-sm">{item.file.name}</p>
    <p class="truncate text-xs text-muted" class:text-danger={state === UploadState.ERROR}>
      {detail}
    </p>

    {#if state === UploadState.STARTED}
      <div class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          class="h-full rounded-full bg-accent transition-[width] duration-200"
          style="width: {item.progress ?? 0}%"
        ></div>
      </div>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-2">
    <span class="text-xs text-muted">{formatBytes(item.file.size)}</span>

    {#if canRetry}
      <button
        type="button"
        class="cursor-pointer text-xs text-muted transition-colors hover:text-foreground"
        title="Retry upload"
        onclick={() => onRetry(item.id)}
      >
        Retry
      </button>
    {/if}

    {#if !inFlight}
      <button
        type="button"
        class="cursor-pointer text-xs text-muted transition-colors hover:text-foreground"
        aria-label="Dismiss {item.file.name}"
        title="Dismiss"
        onclick={() => onDismiss(item.id)}
      >
        ✕
      </button>
    {/if}
  </div>
</li>
