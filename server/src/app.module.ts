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

// this is configuring what inside an AppModule
@Module({
  imports: [ //Other NestJS modules that this module depends on. (importing ConfigModule)
    ConfigModule.forRoot({ // Init the config system. It read your .env variables
      isGlobal: true,      // Allows ConfigModule to be used in every other module without re-importing
      validate: validateEnv, // Pass the env variables to the validateEnv function.
    }),
  ],
  controllers,
  providers: [
    ...common,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
