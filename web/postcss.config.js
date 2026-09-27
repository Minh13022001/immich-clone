/**
 * Tailwind's PostCSS plugin.
 *
 * Decision: wire Tailwind through PostCSS instead of `@tailwindcss/vite`.
 * Reason: Vite declares `jiti`/`lightningcss` as optional peers; the Vite plugin
 * lives in a context where those peers exist, so pnpm materialises a second
 * `vite` instance and TypeScript then sees two incompatible `Plugin` types.
 * The PostCSS route has no Vite peer and keeps a single, shared `vite`.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
