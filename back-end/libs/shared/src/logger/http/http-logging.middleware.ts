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

/**
 * Paths that are never logged: health probes (polled continuously by Docker and by the gateway's
 * own dependency checks) and the Swagger UI (which pulls a burst of static assets on every page
 * load) — logging either would bury real traffic.
 *
 * The gateway's bootstrap sets a global route prefix plus URI versioning, so a genuine health
 * probe's request path arrives as `/api/v1/health/live`, not `/health/live`. This pattern
 * tolerates that optional prefix (an "api" segment, then an optional "v<n>" segment) ahead of
 * `/health`/`/api-docs`, while still requiring the match to end a path segment — a resource such
 * as `/api/v1/imports/health` or `/health-report` is real traffic and must still be logged.
 */
const UNLOGGED_PATH_PATTERN = /^(?:\/api(?:\/v\d+)?)?(?:\/health|\/api-docs)(?:\/|$)/;

/**
 * Request headers worth keeping. An allowlist, not a denylist: a denylist silently leaks every
 * header nobody thought of, which is the wrong default for something written to durable storage.
 */
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

/**
 * Logs the start and the completion of every HTTP request.
 *
 * Must run after `RequestContextMiddleware` so `correlationId`/`requestId` are available.
 *
 * The request body and the full header set are *detail*, emitted only at `debug` and only when
 * that level is actually enabled — so raising the level under load sheds the serialization cost,
 * not just the output.
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

    // The response 'finish'/'close' events can fire outside the AsyncLocalStorage scope opened by
    // RequestContextMiddleware, so the ids are captured here and passed explicitly instead of
    // relying on pino's mixin for the completion line.
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
      // Deliberately not named `req`: that key belongs to pino-http's own serializer.
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
          // Populated by Nest's body parser, which runs before module middleware. Multipart
          // uploads are parsed later, inside the route handler, so file payloads never reach here.
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
