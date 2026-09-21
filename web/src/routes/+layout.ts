/**
 * Render in the browser only.
 *
 * Reason: the SDK talks to the relative `/api` path that Vite proxies in
 * development and that a reverse proxy forwards in production. Keeping the app
 * client-rendered means one code path, no `fetch` plumbing for SSR and no
 * second place where API credentials or URLs would have to be configured.
 * Trade-off: no server-rendered HTML, which this CRUD UI does not need.
 */
export const ssr = false;
