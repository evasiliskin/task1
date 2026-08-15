import { type INestApplication } from '@nestjs/common';
import { buildRequestContextExpressMiddleware } from '@task1/shared/request-context/http/request-context.express-middleware';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { json, urlencoded } from 'express';

/**
 * Mounts the request context ahead of body parsing, then the parsers themselves.
 *
 * Its own module rather than a `main.ts` export: `main.ts` ends in a top-level `await bootstrap()`,
 * so importing from it would boot the whole application inside any test that needs this helper.
 *
 * Callers must create the app with `{ bodyParser: false }`; Nest otherwise registers its parsers
 * before any `app.use()`, which is exactly the ordering this fixes.
 */
export function applyRequestContext(app: INestApplication): void {
  const requestContextService = app.get(RequestContextService);

  app.use(buildRequestContextExpressMiddleware(requestContextService));
  app.use(json());
  app.use(urlencoded({ extended: true }));
}
