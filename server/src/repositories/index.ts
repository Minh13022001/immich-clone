import { DatabaseRepository } from './database.repository';
import { UserRepository } from './user.repository';

/**
 * Provider registry. `app.module.ts` spreads this into `providers`, so adding a
 * repository is a local change: write the file, add one line here.
 */
export const repositories = [DatabaseRepository, UserRepository];
