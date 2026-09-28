<script lang="ts">
  import { toastStore } from '$lib/stores/toast.store.svelte';
  import type { ToastVariant } from '$lib/stores/toast.store.svelte';

  const VARIANT_CLASS: Record<ToastVariant, string> = {
    primary: 'border-accent/60 bg-accent/15',
    danger: 'border-danger/60 bg-danger/15',
    warning: 'border-warning/60 bg-warning/15',
  };
</script>

<div
  class="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(420px,92vw)] -translate-x-1/2 flex-col gap-2"
  role="status"
  aria-live="polite"
>
  {#each toastStore.toasts as toast (toast.id)}
    <div
      class="pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur {VARIANT_CLASS[
        toast.variant
      ]}"
    >
      <span class="min-w-0">{toast.message}</span>
      <button
        type="button"
        class="shrink-0 cursor-pointer text-muted transition-colors hover:text-foreground"
        aria-label="Dismiss notification"
        onclick={() => toastStore.dismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  {/each}
</div>
