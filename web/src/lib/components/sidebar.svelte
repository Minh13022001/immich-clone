<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  import { NAV_ITEMS, isNavItemActive } from '$lib/navigation';

  /** Drives the off-canvas drawer on narrow screens; inert on desktop. */
  let open = $state(false);

  // Close the drawer after every navigation (including the first render), so
  // tapping an entry on mobile reveals the page it navigated to.
  afterNavigate(() => {
    open = false;
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  type="button"
  class="fixed top-4 left-4 z-30 flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-surface p-2.5 lg:hidden"
  aria-controls="app-sidebar"
  aria-expanded={open}
  aria-label={open ? 'Close navigation' : 'Open navigation'}
  onclick={() => (open = !open)}
>
  <span class="block h-0.5 w-5 rounded-full bg-foreground"></span>
  <span class="block h-0.5 w-5 rounded-full bg-foreground"></span>
  <span class="block h-0.5 w-5 rounded-full bg-foreground"></span>
</button>

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-20 cursor-default bg-black/55 lg:hidden"
    aria-label="Close navigation"
    onclick={() => (open = false)}
  ></button>
{/if}

<aside
  id="app-sidebar"
  data-open={open}
  class="fixed inset-y-0 left-0 z-20 flex w-[min(280px,80vw)] -translate-x-full flex-col gap-6 border-r border-border bg-surface p-4 transition-transform duration-200 data-[open=true]:translate-x-0 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-65 lg:translate-x-0"
  aria-label="Primary"
>
  <div class="flex items-center gap-2.5 px-1.5">
    <span
      class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-on-accent"
      aria-hidden="true">ic</span
    >
    <div class="min-w-0">
      <p class="truncate text-sm font-semibold">immich-clone</p>
      <p class="truncate text-xs text-muted">self-hosted media</p>
    </div>
  </div>

  <nav aria-label="Sections">
    <ul class="flex flex-col gap-1">
      {#each NAV_ITEMS as item (item.path)}
        {@const active = isNavItemActive(item, page.url.pathname)}
        <li>
          <a
            href={resolve(item.path)}
            class="-mx-1 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium no-underline transition-colors {active
              ? 'bg-accent/15 text-foreground'
              : 'text-muted hover:bg-accent/10 hover:text-foreground'}"
            aria-current={active ? 'page' : undefined}
          >
            <svg
              class="h-5 w-5 shrink-0 {active ? 'text-accent' : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d={item.icon} />
            </svg>
            <span class="truncate">{item.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <p class="mt-auto px-1.5 text-xs text-muted">v0.1.0</p>
</aside>
