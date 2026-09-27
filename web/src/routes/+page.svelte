<script lang="ts">
  import { resolve } from '$app/paths';

  import { serverInfoManager } from '$lib/managers/server-info-manager.svelte';
  import { userManager } from '$lib/managers/user-manager.svelte';

  const apiStatus = $derived(
    serverInfoManager.error ? 'Unreachable' : serverInfoManager.info ? 'Online' : 'Checking…',
  );
</script>

<section>
  <div class="mb-6">
    <h2 class="text-lg font-semibold">Welcome back</h2>
    <p class="mt-1 text-sm text-muted">A quick look at this immich-clone instance.</p>
  </div>

  {#if userManager.error}
    <p class="mb-4 text-danger" role="alert">{userManager.error}</p>
  {/if}

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <article class="rounded-xl border border-border bg-surface p-4">
      <p class="text-xs font-semibold tracking-wide text-muted uppercase">Users</p>
      <p class="mt-2 text-2xl font-semibold">{userManager.users.length}</p>
      <a class="mt-3 inline-block text-sm" href={resolve('/users')}>Manage users →</a>
    </article>

    <article class="rounded-xl border border-border bg-surface p-4">
      <p class="text-xs font-semibold tracking-wide text-muted uppercase">API status</p>
      <p class="mt-2 text-2xl font-semibold">{apiStatus}</p>
      <p class="mt-3 text-sm text-muted">
        {serverInfoManager.info ? `node ${serverInfoManager.info.nodeVersion}` : 'No response yet'}
      </p>
    </article>

    <article class="rounded-xl border border-border bg-surface p-4">
      <p class="text-xs font-semibold tracking-wide text-muted uppercase">Version</p>
      <p class="mt-2 text-2xl font-semibold">{serverInfoManager.info?.version ?? '—'}</p>
      <p class="mt-3 text-sm text-muted">{serverInfoManager.info?.name ?? 'immich-clone'}</p>
    </article>
  </div>
</section>
