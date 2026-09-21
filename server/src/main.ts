import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { API_PREFIX } from './constants';
import { parseCorsOrigins } from './utils/config';
import type { Env } from './validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);

  // All routes live under /api so the web app, the SDK and the CLI share one
  // stable, unambiguous prefix that a reverse proxy can route on later.
  app.setGlobalPrefix(API_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties that are not in the DTO. Prevents clients from
      // injecting fields like `id` or `createdAt` into an update.
      whitelist: true,
      // Reject unknown properties instead of silently dropping them, so typos
      // in a client payload surface as a 400 rather than a silent no-op.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });

  // Required for `DatabaseRepository.onApplicationShutdown` to run, so the pg
  // pool is drained on SIGTERM instead of leaving connections behind.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
