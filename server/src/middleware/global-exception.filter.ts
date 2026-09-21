import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Last-resort error handler, registered through the `APP_FILTER` token so it
 * applies to every controller without being attached one by one.
 *
 * `HttpException`s (including validation errors produced by `ValidationPipe`)
 * keep their status and body, so the error contract stays consistent. Anything
 * else becomes a generic 500: internal messages are logged, never serialised.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);

      return;
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`${error.message}\n${error.stack ?? ''}`);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
