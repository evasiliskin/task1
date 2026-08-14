import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type AppLogger } from '../app-logger.js';
import { redactLogPayload } from '../redact-payload.js';
import { type LogFields } from '../types.js';

import { LoggerService } from './logger.service.js';

export const REQUEST_STARTED_LOG = 'request started';
export const REQUEST_COMPLETED_LOG = 'request completed';

/**
 * Path segments that are never logged. Health probes are polled continuously by Docker and by
 * the gateway's own dependency checks, and the Swagger UI pulls a burst of static assets on every
 * page load — logging either would bury real traffic.
 */
export const UNLOGGED_PATH_SEGMENTS: readonly string[] = ['health', 'api-docs'];

function isUnloggedPath(path: string): boolean {
  return path.split('/').some((segment) => UNLOGGED_PATH_SEGMENTS.includes(segment));
}

function resolveCompletionLevel(statusCode: number): 'error' | 'info' | 'warn' {
  if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
    return 'error';
  }

  if (statusCode >= Number(HttpStatus.BAD_REQUEST)) {
    return 'warn';
  }

  return 'info';
}

/**
 * Logs the start and the completion of every HTTP request.
 *
 * Must run after `RequestContextMiddleware` so `correlationId`/`requestId` are available — that
 * ordering is guaranteed by `RequestContextModule` being imported before `LoggerModule`.
 *
 * `pino-http`'s built-in `autoLogging` is disabled (see `pinoConfigFactory`) so that HTTP request
 * logging has exactly one owner.
 */
@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  public constructor(
    loggerService: LoggerService,
    private readonly requestContextService: RequestContextService,
  ) {
    this.logger = loggerService.getLogger(HttpLoggingMiddleware.name, 'http');
  }

  public use(request: Request, response: Response, next: NextFunction): void {
    if (isUnloggedPath(request.path)) {
      next();

      return;
    }

    // The response 'finish'/'close' events fire outside the AsyncLocalStorage scope opened by
    // RequestContextMiddleware, so the ids are captured here and passed explicitly instead of
    // relying on pino's mixin for the completion line.
    const context = this.requestContextService.getAttributes();
    const startedAt = Date.now();

    this.logger.info(this.buildStartFields(request, context), REQUEST_STARTED_LOG);

    let completionLogged = false;
    const logCompletion = (): void => {
      if (completionLogged) {
        return;
      }

      completionLogged = true;

      const fields = this.buildCompletionFields(request, response, context, Date.now() - startedAt);

      this.logger[resolveCompletionLevel(response.statusCode)](fields, REQUEST_COMPLETED_LOG);
    };

    response.on('finish', logCompletion);
    response.on('close', logCompletion);

    next();
  }

  private readonly logger: AppLogger;

  private buildStartFields(request: Request, context: LogFields): LogFields {
    return {
      ...context,
      // Deliberately not named `req`: pino-http registers a `req` serializer that would rewrite
      // this object into its own shape, dropping the body, path and ip captured here.
      request: redactLogPayload({
        method: request.method,
        url: request.originalUrl,
        path: request.path,
        query: request.query,
        // Populated by Nest's body parser, which runs before module middleware. Multipart
        // uploads are parsed later, inside the route handler, so file payloads never reach here.
        body: request.body as unknown,
        headers: request.headers,
        ip: request.ip,
      }),
    };
  }

  private buildCompletionFields(
    request: Request,
    response: Response,
    context: LogFields,
    durationMs: number,
  ): LogFields {
    return {
      ...context,
      method: request.method,
      url: request.originalUrl,
      statusCode: response.statusCode,
      contentLength: response.getHeader('content-length'),
      durationMs,
    };
  }
}
