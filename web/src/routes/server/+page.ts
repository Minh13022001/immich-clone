import { serverInfoManager } from '$lib/managers/server-info-manager.svelte';

/**
 * Runs in the browser because `ssr` is disabled in the layout. The manager's
 * `load` swallows failures onto its store, so the page renders an error state
 * from data rather than being thrown into `+error.svelte`.
 */
export async function load(): Promise<void> {
  await serverInfoManager.load();
}
