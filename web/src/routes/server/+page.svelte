<script lang="ts">
  import { serverInfoManager } from '$lib/managers/server-info-manager.svelte';

  // The manager exposes no loading flag, so this page tracks its own refresh.
  let busy = $state(false);

  async function refresh(): Promise<void> {
    busy = true;

    try {
      await serverInfoManager.load();
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <div class="mb-6 flex items-end justify-between gap-4">
    <div>
      <h2 class="text-lg font-semibold">Server</h2>
      <p class="mt-1 text-sm text-muted">Runtime and build details reported by the API.</p>
    </div>
    <button type="button" class="btn btn-secondary" onclick={refresh} disabled={busy}>
      {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>

  {#if serverInfoManager.error}
    <p class="text-danger" role="alert">{serverInfoManager.error}</p>
  {:else if serverInfoManager.info}
    <dl class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      <div class="flex justify-between gap-4 px-4 py-3">
        <dt class="text-sm text-muted">Name</dt>
        <dd class="text-sm font-medium">{serverInfoManager.info.name}</dd>
      </div>
      <div class="flex justify-between gap-4 px-4 py-3">
        <dt class="text-sm text-muted">Version</dt>
        <dd class="text-sm font-medium">{serverInfoManager.info.version}</dd>
      </div>
      <div class="flex justify-between gap-4 px-4 py-3">
        <dt class="text-sm text-muted">Node</dt>
        <dd class="text-sm font-medium">{serverInfoManager.info.nodeVersion}</dd>
      </div>
    </dl>
  {:else}
    <p class="text-muted">Loading…</p>
  {/if}
</section>
