import { type INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FatalError } from '@task1/shared/errors/internal/fatal-error';
import { CentralizedErrorHandlerService } from '@task1/shared/exception-handling/centralized-error-handler.service';
import { LoggerService } from '@task1/shared/logger/http/logger.service';
import { NestLoggerBridge } from '@task1/shared/logger/nest-logger.bridge';
import { createHelmetMiddleware } from '@task1/shared/security/helmet.config';

import { AppModule } from './app.module.js';
import appConfig from './config/app.config.js';

async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;

  try {
    app = await NestFactory.create(AppModule, { bufferLogs: true });

    const loggerService = app.get(LoggerService);
    const bootstrapLogger = loggerService.getLogger('Nest', 'bootstrap');
    app.useLogger(new NestLoggerBridge(bootstrapLogger));

    app.use(createHelmetMiddleware());

    app.setGlobalPrefix('api');

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    app.enableShutdownHooks();

    const swaggerConfig = new DocumentBuilder().setTitle('Gateway API').setVersion('1.0').build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api-docs', app, swaggerDocument);

    const { port } = appConfig();
    await app.listen(port);

    // Bootstrap is over. Everything Nest logs from here on — unhandled errors surfaced by
    // GlobalExceptionFilter, shutdown notices — belongs to request handling, not to startup, so
    // it must not keep the "bootstrap" channel.
    app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'http')));
  } catch (error) {
    if (app === undefined) {
      // eslint-disable-next-line n/no-process-exit -- no DI container available yet to resolve CentralizedErrorHandlerService
      process.exit(1);
    }

    app.get(CentralizedErrorHandlerService).handleError(new FatalError(error));
  }
}

await bootstrap();
