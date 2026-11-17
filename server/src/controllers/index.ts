import { AssetMediaController } from './asset-media.controller';
import { AssetUploadController } from './asset-upload.controller';
import { EventsController } from './event.controller';
import { HealthController } from './health.controller';
import { LocalUploadController } from './local-upload.controller';
import { ServerController } from './server.controller';
import { UserController } from './user.controller';

/**
 * Controller registry, spread into `controllers` by `app.module.ts`.
 *
 * Note that there is no `UsersModule`: the reference layout deliberately keeps
 * one application module and expresses composition through these registries,
 * which keeps a feature's wiring to three lines (repository, service, controller).
 */
export const controllers = [
  HealthController,
  UserController,
  ServerController,
  AssetMediaController,
  // The upload routes are registered before the media controller's wildcard-ish
  // `:id` GETs so `assets/uploads/*` can never be mistaken for an asset id.
  AssetUploadController,
  LocalUploadController,
  EventsController,
];
