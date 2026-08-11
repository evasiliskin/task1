import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  public use(request: Request, res: Response, next: NextFunction): void {
    const existing = request.headers['x-correlation-id'];
    const correlationId =
      typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();

    request.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
