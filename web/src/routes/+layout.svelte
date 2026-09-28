<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  import { page } from '$app/state';
  import ServerInfoBadge from '$lib/components/server-info-badge.svelte';
  import Sidebar from '$lib/components/sidebar.svelte';
  import ToastList from '$lib/components/toast-list.svelte';
  import UploadPanel from '$lib/components/upload/upload-panel.svelte';
  import { timelineManager } from '$lib/managers/timeline-manager.svelte';
  import { findNavItem } from '$lib/navigation';

  import '../app.css';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // One source of truth for both the highlighted sidebar entry and this title.
  const currentPage = $derived(findNavItem(page.url.pathname));

  // The event stream is app-wide (spec §8.6): connecting here keeps the upload
  // panel and any live view updating while the user navigates. `onMount` keeps
  // it browser-only, since `EventSource` does not exist during SSR.
  onMount(() => {
    timelineManager.connect();

    return () => timelineManager.disconnect();
  });
</script>

<div class="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
  <Sidebar />

  <div class="flex min-w-0 flex-col">
    <header
      class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/85 px-6 py-4 backdrop-blur"
    >
      <div class="min-w-0 pl-14 lg:pl-0">
        <p class="truncate text-base font-semibold">{currentPage?.label ?? 'immich-clone'}</p>
        {#if currentPage}
          <p class="truncate text-xs text-muted">{currentPage.description}</p>
        {/if}
      </div>
      <ServerInfoBadge />
    </header>

    <main class="min-w-0 px-6 py-8">
      {@render children()}
    </main>
  </div>
</div>

<UploadPanel />
<ToastList />
