import type { NextFunction, Request, Response } from 'express';

import { type RequestContextService } from '../request-context.service.js';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../request-context.types.js';
import { resolveRequestContext } from '../resolve-request-context.util.js';

/**
 * The same logic as `RequestContextMiddleware`, shaped as a bare Express handler so it can be
 * mounted with `app.use()` *before* Nest's body parser.
 *
 * Module middleware runs after body parsing, so a malformed JSON body used to fail with no context
 * at all: the error envelope carried a correlation id that appeared in exactly one log line and in
 * no response header.
 */
export function buildRequestContextExpressMiddleware(
  requestContextService: RequestContextService,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const context = resolveRequestContext(request.headers);

    response.setHeader(CORRELATION_ID_HEADER, context.correlationId);
    response.setHeader(REQUEST_ID_HEADER, context.requestId);

    requestContextService.run(context, next);
  };
}
