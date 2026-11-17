import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX } from './constants';
import { parseCorsOrigins } from './utils/config';
import type { Env } from './validation';

// this define the function that start the server.
// starting server is async cause it need create app, config app,
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false }); // Create my application using AppModule.
  const config = app.get(ConfigService<Env, true>); // Get the ConfigService service.

  app.setGlobalPrefix(API_PREFIX); // Set the global prefix for all routes.

  app.useGlobalPipes(
    // Validates incoming request data using my DTOs.
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      // `transform` is required for the multipart upload DTO: multer delivers
      // every text field as a string, and `@Transform` only runs when the pipe
      // materialises the DTO instance.
      transform: true,
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });

  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  // `0.0.0.0` accepts every interface, which is what a container needs; a host
  // that wants a single NIC sets `HOST` instead of narrowing this call.
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
