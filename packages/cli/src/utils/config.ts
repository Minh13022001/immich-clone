import { setBaseUrl } from '@immich/sdk';
import type { Command } from 'commander';

export const DEFAULT_API_URL = 'http://localhost:2283/api';

export interface GlobalOptions {
  url?: string;
}

/**
 * Resolves which API the CLI talks to and points the SDK at it.
 *
 * Precedence: the `--url` flag, then `IMMICH_INSTANCE_URL`, then localhost. The
 * flag is declared once on the program, so nested commands read it back with
 * `optsWithGlobals()` instead of re-declaring it everywhere.
 */
export function resolveApiUrl(command: Command): string {
  const options = command.optsWithGlobals<GlobalOptions>();
  const url = options.url ?? process.env.IMMICH_INSTANCE_URL ?? DEFAULT_API_URL;

  setBaseUrl(url);

  return url;
}
