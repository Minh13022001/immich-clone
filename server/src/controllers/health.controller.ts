import { Controller, Get } from '@nestjs/common';

import { DatabaseRepository } from '../repositories/database.repository';

export interface HealthCheckResponse {
  status: 'ok';
  database: 'up';
}

/**
 * Liveness/readiness probe. It touches the database on purpose: an API that
 * cannot reach Postgres is not healthy, and the container health check should
 * notice.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly databaseRepository: DatabaseRepository) {}

  @Get()
  async getHealth(): Promise<HealthCheckResponse> {
    await this.databaseRepository.ping();

    return { status: 'ok', database: 'up' };
  }
}
