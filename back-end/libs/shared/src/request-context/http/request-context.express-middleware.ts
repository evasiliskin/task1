import type { NextFunction, Request, Response } from 'express';

import { type RequestContextService } from '../request-context.service.js';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../request-context.types.js';
import { resolveRequestContext } from '../resolve-request-context.util.js';

export function buildRequestContextExpressMiddleware(
  requestContextService: RequestContextService,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    if (requestContextService.getCorrelationId() !== undefined) {
      next();

      return;
    }

    const context = resolveRequestContext(request.headers);

    response.setHeader(CORRELATION_ID_HEADER, context.correlationId);
    response.setHeader(REQUEST_ID_HEADER, context.requestId);

    requestContextService.run(context, next);
  };
}
