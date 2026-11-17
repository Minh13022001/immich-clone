import { AssetFinalizerService } from './asset-finalizer.service';
import { AssetMediaService } from './asset-media.service';
import { AssetUploadService } from './asset-upload.service';
import { AuthService } from './auth.service';
import { JobService } from './job.service';
import { ServerInfoService } from './server-info.service';
import { UploadCleanupService } from './upload-cleanup.service';
import { UserService } from './user.service';

/**
 * Provider registry, spread into `providers` by `app.module.ts`.
 *
 * `BaseService` is intentionally absent: it is an abstract-ish helper, not an
 * injectable, so it is extended rather than provided.
 *
 * `AssetFinalizerService` is the single place that turns verified bytes into an
 * asset row, so the multipart upload path and the presigned direct path cannot
 * drift apart on quota accounting, live-photo linking or job/event fan-out.
 */
export const services = [
  UserService,
  ServerInfoService,
  AuthService,
  AssetMediaService,
  AssetUploadService,
  AssetFinalizerService,
  JobService,
  UploadCleanupService,
];
