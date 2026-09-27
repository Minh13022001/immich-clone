import { userManager } from '$lib/managers/user-manager.svelte';

/**
 * Runs in the browser because `ssr` is disabled in the layout.
 *
 * Nothing is returned: the manager keeps the collection in a store, so the page
 * and its components all read the same state. Failures land on the store rather
 * than being thrown, which is why this never sends the user to an error page.
 */
export async function load(): Promise<void> {
  await userManager.load();
}
