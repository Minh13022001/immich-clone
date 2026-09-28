import { Injectable } from '@nestjs/common';

import { APP_NAME, APP_VERSION } from '../constants';
import type { ServerInfoDto, SupportedMediaTypesDto } from '../dtos/server-info.dto';
import { getSupportedMediaTypes as collectSupportedMediaTypes } from '../utils/mime-types';
import { BaseService } from './base.service';

/**
 * Reports what is running. The reference project exposes the same endpoint as
 * `GET /server-info` so clients and the CLI can verify connectivity without
 * touching the database.
 */
@Injectable()
export class ServerInfoService extends BaseService {
  getServerInfo(): ServerInfoDto {
    return {
      name: APP_NAME,
      version: APP_VERSION,
      nodeVersion: process.version,
    };
  }

  /**
   * Mime types an upload may carry (spec §8.3). Served from the same registry
   * `canUploadFile` enforces, so the picker filter can never drift from the API.
   */
  getSupportedMediaTypes(): SupportedMediaTypesDto {
    return collectSupportedMediaTypes();
  }
}
