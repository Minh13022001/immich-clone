<script lang="ts">
  import type { Snippet } from 'svelte';

  import ServerInfoBadge from '$lib/components/server-info-badge.svelte';

  import '../app.css';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="shell">
  <header>
    <h1>immich-clone</h1>
    <ServerInfoBadge />
  </header>

  <main>
    {@render children()}
  </main>
</div>
