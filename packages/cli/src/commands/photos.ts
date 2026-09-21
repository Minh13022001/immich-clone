import { createPhoto, deletePhoto, getPhotos } from '@immich/sdk';
import type { Command } from 'commander';

import { resolveApiUrl } from '../utils/config';

export function registerPhotosCommands(program: Command): void {
  const photos = program.command('photos').description('Manage photos');

  photos
    .command('list')
    .description('List every photo, newest first')
    .action(async (_options: unknown, command: Command) => {
      resolveApiUrl(command);

      const list = await getPhotos();
      if (list.length === 0) {
        console.log('No photos yet.');
        return;
      }

      for (const photo of list) {
        console.log(`${photo.id}  ${new Date(photo.createdAt).toISOString()}  ${photo.name}`);
      }
    });

  photos
    .command('create')
    .argument('<name>', 'name of the photo')
    .description('Create a photo')
    .action(async (name: string, _options: unknown, command: Command) => {
      resolveApiUrl(command);

      const photo = await createPhoto(name);
      console.log(`Created ${photo.id}`);
    });

  photos
    .command('delete')
    .argument('<id>', 'photo id')
    .description('Delete a photo')
    .action(async (id: string, _options: unknown, command: Command) => {
      resolveApiUrl(command);

      await deletePhoto(id);
      console.log(`Deleted ${id}`);
    });
}
