import { Command } from 'commander';

import { registerServerInfoCommand } from './commands/server-info';
import { registerUsersCommands } from './commands/users';

/**
 * CLI entry point: one program, one command group per resource.
 *
 * Failures are printed once and turned into a non-zero exit code, so the CLI is
 * usable from scripts — a rejected promise must not surface as an unhandled
 * rejection stack trace.
 */
const program = new Command()
  .name('immich-clone')
  .description('Command line client for the immich-clone API')
  .version('0.1.0')
  .option('-u, --url <url>', 'base URL of the API (default: http://localhost:2283/api)');

registerServerInfoCommand(program);
registerUsersCommands(program);

/**
 * Drops a lone `--` that package managers insert between the script name and
 * the user's arguments (`pnpm run cli -- users list`). Commander treats it as
 * "end of options", so any flag after it would silently be ignored.
 */
function withoutSeparator(argv: string[]): string[] {
  const separator = argv.indexOf('--');

  return separator === -1 ? argv : [...argv.slice(0, separator), ...argv.slice(separator + 1)];
}

program.parseAsync(withoutSeparator(process.argv)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
