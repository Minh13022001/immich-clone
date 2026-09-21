<script lang="ts">
  import { serverInfoManager } from '$lib/managers/server-info-manager.svelte';

  // Runs once on mount: the call itself touches no reactive state.
  $effect(() => {
    void serverInfoManager.load();
  });
</script>

{#if serverInfoManager.error}
  <span class="muted" title={serverInfoManager.error}>API unreachable</span>
{:else if serverInfoManager.info}
  <span class="muted">
    {serverInfoManager.info.name} v{serverInfoManager.info.version} · node {serverInfoManager.info
      .nodeVersion}
  </span>
{:else}
  <span class="muted">connecting…</span>
{/if}
