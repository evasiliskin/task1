import { type INestApplication } from '@nestjs/common';
import { buildRequestContextExpressMiddleware } from '@task1/shared/request-context/http/request-context.express-middleware';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { json, urlencoded } from 'express';

export function applyRequestContext(app: INestApplication): void {
  const requestContextService = app.get(RequestContextService);

  app.use(buildRequestContextExpressMiddleware(requestContextService));
  app.use(json());
  app.use(urlencoded({ extended: true }));
}
