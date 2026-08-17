import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { isProduction } from '@task1/shared/config/environment.helper';

const DOCS_PATH = 'api-docs';

/**
 * Mounts the Swagger UI outside production, and reports whether it did.
 *
 * `SwaggerModule.setup` registers Express-level middleware, so the global `AuthGuard` never runs for
 * `/api-docs` and `helmet.config.ts` deliberately relaxes CSP there so the UI can execute. In
 * production that combination publishes the whole internal API surface with no credential check.
 *
 * Its own module rather than inline in `main.ts`: that file ends in a top-level `await bootstrap()`,
 * so importing it from a test would boot the application — the same reason
 * `request-context.setup.ts` exists.
 */
export function applySwagger(app: INestApplication): boolean {
  if (isProduction()) {
    return false;
  }

  const config = new DocumentBuilder().setTitle('Gateway API').setVersion('1.0').build();

  SwaggerModule.setup(DOCS_PATH, app, SwaggerModule.createDocument(app, config));

  return true;
}
