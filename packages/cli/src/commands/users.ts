import { createUser, deleteUser, getUsers } from '@immich/sdk';
import type { Command } from 'commander';

import { resolveApiUrl } from '../utils/config';

export function registerUsersCommands(program: Command): void {
  const users = program.command('users').description('Manage users');

  users
    .command('list')
    .description('List every user, newest first')
    .action(async (_options: unknown, command: Command) => {
      resolveApiUrl(command);

      const list = await getUsers();
      if (list.length === 0) {
        console.log('No users yet.');
        return;
      }

      for (const user of list) {
        console.log(
          `${user.id}  ${new Date(user.createdAt).toISOString()}  ${user.name}  <${user.email}>`,
        );
      }
    });

  users
    .command('create')
    .argument('<name>', 'name of the user')
    .argument('<email>', 'email address of the user')
    .description('Create a user')
    .action(async (name: string, email: string, _options: unknown, command: Command) => {
      resolveApiUrl(command);

      const user = await createUser(name, email);
      console.log(`Created ${user.id}`);
    });

  users
    .command('delete')
    .argument('<id>', 'user id')
    .description('Delete a user')
    .action(async (id: string, _options: unknown, command: Command) => {
      resolveApiUrl(command);

      await deleteUser(id);
      console.log(`Deleted ${id}`);
    });
}
