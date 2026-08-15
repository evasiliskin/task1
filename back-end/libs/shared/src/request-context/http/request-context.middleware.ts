import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from '../request-context.service.js';

import { buildRequestContextExpressMiddleware } from './request-context.express-middleware.js';

/**
 * Fallback for hosts that do not call `applyRequestContext` at the adapter level (integration
 * tests, and any future non-Express adapter). Idempotent: re-running `als.run` with the same ids
 * is harmless, and `applyRequestContext` has already set the response headers.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  public constructor(requestContextService: RequestContextService) {
    this.handler = buildRequestContextExpressMiddleware(requestContextService);
  }

  public use(request: Request, response: Response, next: NextFunction): void {
    this.handler(request, response, next);
  }

  private readonly handler: (request: Request, response: Response, next: NextFunction) => void;
}
