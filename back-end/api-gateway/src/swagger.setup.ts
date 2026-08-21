import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import swaggerConfig from './config/swagger.config.js';

const DOCS_PATH = 'api-docs';

export function applySwagger(app: INestApplication): boolean {
  if (!swaggerConfig().enabled) {
    return false;
  }

  const config = new DocumentBuilder().setTitle('Gateway API').setVersion('1.0').build();

  SwaggerModule.setup(DOCS_PATH, app, SwaggerModule.createDocument(app, config));

  return true;
}
