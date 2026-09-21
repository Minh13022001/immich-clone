import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Decision: read the proxy target through `loadEnv`, not just `process.env`.
  // Reason: Vite only feeds `.env` values to application code automatically;
  // the config file itself would otherwise need a shell variable every time,
  // so a machine that has to move the API port could not express it in a file.
  // Trade-off: `web/.env` is a second place that knows the API port, so it must
  // agree with `PORT` in `server/.env`. The README calls this out.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // `PORT` is honoured as a fallback so that a single `PORT=2284 pnpm dev`
  // moves the API *and* the proxy that points at it.
  const apiPort = process.env.PORT ?? '2283';
  const apiTarget =
    env.VITE_API_PROXY || process.env.VITE_API_PROXY || `http://localhost:${apiPort}`;

  return {
    plugins: [sveltekit()],
    // The SDK is consumed as raw TypeScript from the workspace rather than as a
    // built dependency, so it must stay out of Vite's pre-bundling step.
    optimizeDeps: {
      exclude: ['@immich/sdk'],
    },
    server: {
      port: 3000,
      // Decision: proxy /api to the Nest server instead of calling it cross-origin.
      // Reason: the browser sees one origin, so there is no CORS preflight in dev
      // and the same relative URLs work behind a reverse proxy in production.
      // Trade-off: the dev server must know where the API lives (VITE_API_PROXY).
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
