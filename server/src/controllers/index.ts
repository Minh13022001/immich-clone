import { HealthController } from './health.controller';
import { PhotoController } from './photo.controller';
import { ServerController } from './server.controller';

/**
 * Controller registry, spread into `controllers` by `app.module.ts`.
 *
 * Note that there is no `PhotosModule`: the reference layout deliberately keeps
 * one application module and expresses composition through these registries,
 * which keeps a feature's wiring to three lines (repository, service, controller).
 */
export const controllers = [HealthController, PhotoController, ServerController];
