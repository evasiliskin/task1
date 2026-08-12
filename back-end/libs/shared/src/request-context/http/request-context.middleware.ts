import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { resolveId } from '../id-validation.util';
import { RequestContextService } from '../request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../request-context.types';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    // eslint-disable-next-line security/detect-object-injection
    const correlationId = resolveId(request.headers[CORRELATION_ID_HEADER]);
    // eslint-disable-next-line security/detect-object-injection
    const requestId = resolveId(request.headers[REQUEST_ID_HEADER]);

    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.setHeader(REQUEST_ID_HEADER, requestId);

    this.requestContextService.run({ correlationId, requestId }, next);
  }
}
