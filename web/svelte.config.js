import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * `adapter-node` keeps the output a plain Node server (like the API), so both
 * apps deploy the same way. `vitePreprocess` is what makes TypeScript inside
 * `.svelte` files (including Svelte 5 runes) work without a separate toolchain.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};

export default config;
