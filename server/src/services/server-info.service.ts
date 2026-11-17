import { Injectable } from '@nestjs/common';

import { APP_NAME, APP_VERSION } from '../constants';
import type {
  ServerInfoDto,
  StorageCapabilitiesDto,
  SupportedMediaTypesDto,
} from '../dtos/server-info.dto';
import { ObjectStorageRepository } from '../repositories/object-storage.repository';
import { getSupportedMediaTypes as collectSupportedMediaTypes } from '../utils/mime-types';
import { BaseService } from './base.service';

/**
 * Reports what is running. The reference project exposes the same endpoint as
 * `GET /server-info` so clients and the CLI can verify connectivity without
 * touching the database.
 *
 * It also publishes the storage capabilities, so the web uploader learns the
 * backend, the ceiling and the multipart thresholds from the server that will
 * enforce them instead of duplicating those defaults in client code.
 */
@Injectable()
export class ServerInfoService extends BaseService {
  constructor(private readonly storage: ObjectStorageRepository) {
    super();
  }

  getServerInfo(): ServerInfoDto {
    return {
      name: APP_NAME,
      version: APP_VERSION,
      nodeVersion: process.version,
      storage: this.getStorageCapabilities(),
    };
  }

  /** The limits a direct-upload client needs before it starts (brief §4). */
  getStorageCapabilities(): StorageCapabilitiesDto {
    return {
      backend: this.storage.getBackend(),
      maxUploadSize: this.storage.getMaxUploadSize(),
      multipartThreshold: this.storage.getMultipartThreshold(),
      partSize: this.storage.getPartSize(),
      multipart: this.storage.supportsMultipart(),
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
