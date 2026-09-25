import { Controller, Get } from '@nestjs/common';

import type { ServerInfoDto } from '../dtos/server-info.dto';
import { ServerInfoService } from '../services/server-info.service';

@Controller('server-info')
export class ServerController {
  constructor(private readonly serverInfoService: ServerInfoService) {
    // Runs ONCE at boot, when the container instantiates this controller.
    // Not per request.
    console.log('[BOOT] ServerController instantiated, service injected:', this.serverInfoService);
  }

  @Get()
  getServerInfo(): ServerInfoDto {
    // Step 2: the router sent the request here, after validation passed.
    const result = this.serverInfoService.getServerInfo();
    return result;
  }
}
