import { AssetFileRepository } from './asset-file.repository';
import { AssetRepository } from './asset.repository';
import { AssetUploadRepository } from './asset-upload.repository';
import { DatabaseRepository } from './database.repository';
import { EventRepository } from './event.repository';
import { ExifRepository } from './exif.repository';
import { JobRepository } from './job.repository';
import { ObjectStorageRepository } from './object-storage.repository';
import { StorageRepository } from './storage.repository';
import { UserRepository } from './user.repository';

/**
 * Provider registry. `app.module.ts` spreads this into `providers`, so adding a
 * repository is a local change: write the file, add one line here.
 */
export const repositories = [
  DatabaseRepository,
  UserRepository,
  AssetRepository,
  AssetFileRepository,
  AssetUploadRepository,
  ExifRepository,
  JobRepository,
  StorageRepository,
  ObjectStorageRepository,
  EventRepository,
];
