import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import swaggerConfig from './config/swagger.config.js';

const DOCS_PATH = 'api-docs';

/**
 * Mounts the Swagger UI when `SWAGGER_ENABLED` allows it, and reports whether it did.
 *
 * `SwaggerModule.setup` registers Express-level middleware, so the global `AuthGuard` never runs for
 * `/api-docs` and `helmet.config.ts` deliberately relaxes CSP there so the UI can execute. That
 * combination publishes the whole internal API surface with no credential check, which is why this
 * is opt-in: the flag defaults to `!isProduction()`, so an unset variable in production still
 * yields 404. The compose stack opts in explicitly (`SWAGGER_ENABLED=true`) so the documented API
 * is reachable at `http://localhost:3000/api-docs`.
 *
 * Its own module rather than inline in `main.ts`: that file ends in a top-level `await bootstrap()`,
 * so importing it from a test would boot the application — the same reason
 * `request-context.setup.ts` exists.
 */
export function applySwagger(app: INestApplication): boolean {
  if (!swaggerConfig().enabled) {
    return false;
  }

  const config = new DocumentBuilder().setTitle('Gateway API').setVersion('1.0').build();

  SwaggerModule.setup(DOCS_PATH, app, SwaggerModule.createDocument(app, config));

  return true;
}
