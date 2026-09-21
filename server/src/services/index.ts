import { PhotoService } from './photo.service';
import { ServerInfoService } from './server-info.service';

/**
 * Provider registry, spread into `providers` by `app.module.ts`.
 *
 * `BaseService` is intentionally absent: it is an abstract-ish helper, not an
 * injectable, so it is extended rather than provided.
 */
export const services = [PhotoService, ServerInfoService];
