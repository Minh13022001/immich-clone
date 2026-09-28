import { AssetUploadInterceptor } from './asset-upload.interceptor';
import { FileUploadInterceptor } from './file-upload.interceptor';

/**
 * Interceptor registry, spread into `providers` by `app.module.ts`.
 *
 * Both are registered as providers (not just referenced from
 * `@UseInterceptors`) so Nest injects `AssetMediaService` into them.
 */
export const interceptors = [AssetUploadInterceptor, FileUploadInterceptor];
