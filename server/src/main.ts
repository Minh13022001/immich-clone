import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

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

  // Step 1 of every request: middleware. Runs BEFORE routing and validation,
  // for all paths, including 404s.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[REQ 1] middleware saw ${req.method} ${req.originalUrl}`);
    next();
  });

  app.useGlobalPipes( // Validates incoming request data using my DTOs.
    new ValidationPipe({

      whitelist: true,

      forbidNonWhitelisted: true,
      // transform: true,
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });

  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  // my laptop can have many network interface (wifi: 10.10.10.80, ethernet: 192.168.1.20, ...), so if 0.0.0.0, it will listen on all of them
  // But if we set 10.10.10.80, then it will only listen on that interface,

  Logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap(); //void means “I intentionally don't use/care about that returned Promise.”
