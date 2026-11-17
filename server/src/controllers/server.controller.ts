import { Controller, Get } from '@nestjs/common';

import type { ServerInfoDto, SupportedMediaTypesDto } from '../dtos/server-info.dto';
import { ServerInfoService } from '../services/server-info.service';

@Controller('server-info')
export class ServerController {
  constructor(private readonly serverInfoService: ServerInfoService) {}

  @Get()
  getServerInfo(): ServerInfoDto {
    return this.serverInfoService.getServerInfo();
  }

  /** Mime types the upload endpoint accepts; the web derives its picker filter. */
  @Get('media-types')
  getSupportedMediaTypes(): SupportedMediaTypesDto {
    return this.serverInfoService.getSupportedMediaTypes();
  }
}
