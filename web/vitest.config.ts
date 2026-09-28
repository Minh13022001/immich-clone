import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/**
 * Test runner configuration for the client (spec §10).
 *
 * `sveltekit()` is what makes the specs behave like the app: it supplies the
 * `$lib` alias and compiles `.svelte.ts` modules, so the rune-based store can be
 * imported and asserted on directly.
 *
 * Environment note: `node`, not `jsdom`/`happy-dom` (neither is installed, and
 * adding a DOM just for the suite is a bigger dependency than the code under
 * test). Everything covered here — the queue, the store state machine, the
 * orchestrator — works against `File`/`FormData`/`setTimeout`, all of which Node
 * provides. The parts that genuinely need a browser (`document`-based file
 * picker, XHR transport, drop handling) are covered by the manual checks in the
 * plan rather than pretended at with a DOM shim.
 */
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
  },
});
