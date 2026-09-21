import { getServerInfo } from '@immich/sdk';
import type { Command } from 'commander';

import { resolveApiUrl } from '../utils/config';

export function registerServerInfoCommand(program: Command): void {
  program
    .command('server-info')
    .description('Print the version of the API the CLI is talking to')
    .action(async (_options: unknown, command: Command) => {
      const url = resolveApiUrl(command);
      const info = await getServerInfo();

      console.log(`${info.name} ${info.version} (node ${info.nodeVersion})`);
      console.log(`API: ${url}`);
    });
}
