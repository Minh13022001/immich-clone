import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';

import { controllers } from './controllers';
import { GlobalExceptionFilter } from './middleware/global-exception.filter';
import { repositories } from './repositories';
import { services } from './services';
import { validateEnv } from './validation';

/**
 * Repositories and services are registered once and shared by every controller,
 * which is why `common` is spread into both `providers` and (conceptually) the
 * controller graph. This mirrors the reference layout: one application module,
 * composition expressed through the `index.ts` registries instead of a module
 * per feature.
 */
const common = [...repositories, ...services];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
  controllers,
  providers: [
    ...common,
    // Registered by token so every request — not just the ones that opt in via
    // `@UseFilters` — goes through the same error shaping.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
