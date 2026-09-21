import { Controller, Get } from '@nestjs/common';

import type { ServerInfoDto } from '../dtos/server-info.dto';
import { ServerInfoService } from '../services/server-info.service';

@Controller('server-info')
export class ServerController {
  constructor(private readonly serverInfoService: ServerInfoService) {}

  @Get()
  getServerInfo(): ServerInfoDto {
    return this.serverInfoService.getServerInfo();
  }
}
