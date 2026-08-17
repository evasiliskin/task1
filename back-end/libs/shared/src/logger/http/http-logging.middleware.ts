import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type AppLogger } from '../app-logger.js';
import { LoggerService } from '../logger.service.js';
import { truncateForLog } from '../truncate.util.js';
import { type LogFields } from '../types.js';

export const REQUEST_STARTED_LOG = 'request started';
export const REQUEST_COMPLETED_LOG = 'request completed';
export const REQUEST_DETAIL_LOG = 'request detail';

const UNLOGGED_PATH_PATTERN = /^(?:\/api(?:\/v\d+)?)?(?:\/health|\/api-docs)(?:\/|$)/;

export const LOGGED_HEADERS: readonly string[] = [
  'user-agent',
  'content-type',
  'content-length',
  'referer',
  'x-forwarded-for',
  'idempotency-key',
];

export function isUnloggedPath(path: string): boolean {
  return UNLOGGED_PATH_PATTERN.test(path);
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

function pickHeaders(headers: Request['headers']): Record<string, unknown> {
  return Object.fromEntries(
    LOGGED_HEADERS
      // eslint-disable-next-line security/detect-object-injection -- `name` comes from the fixed LOGGED_HEADERS literal, never from external input.
      .map((name) => [name, headers[name]] as const)
      .filter(([, value]) => value !== undefined),
  );
}

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

    const context = this.requestContextService.getAttributes();
    const startedAt = Date.now();

    this.logger.info(this.buildStartFields(request, context), REQUEST_STARTED_LOG);
    this.logDetail(request, context);

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
      request: {
        method: request.method,
        url: request.originalUrl,
        path: request.path,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    };
  }

  private logDetail(request: Request, context: LogFields): void {
    if (!this.logger.isLevelEnabled('debug')) {
      return;
    }

    this.logger.debug(
      {
        ...context,
        request: {
          method: request.method,
          url: request.originalUrl,
          query: truncateForLog(request.query),
          body: truncateForLog(request.body as unknown),
          headers: pickHeaders(request.headers),
        },
      },
      REQUEST_DETAIL_LOG,
    );
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
