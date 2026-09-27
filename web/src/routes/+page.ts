import { serverInfoManager } from '$lib/managers/server-info-manager.svelte';
import { userManager } from '$lib/managers/user-manager.svelte';

/**
 * Runs in the browser because `ssr` is disabled in the layout.
 *
 * The overview needs both collections up front: the user count for its headline
 * figure and the server info for the API/version cards. Both managers keep their
 * results in a store, so sibling pages and the header badge read the same state.
 * Failures land on those stores rather than being thrown, so this never routes
 * the user to an error page.
 */
export async function load(): Promise<void> {
  await Promise.all([userManager.load(), serverInfoManager.load()]);
}
