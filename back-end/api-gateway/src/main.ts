import { type INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FatalError } from '@task1/shared/errors/internal/fatal-error';
import { CentralizedErrorHandlerService } from '@task1/shared/exception-handling/centralized-error-handler.service';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { PINO_LOGGER } from '@task1/shared/logger/logger.tokens';
import { NestLoggerBridge } from '@task1/shared/logger/nest-logger.bridge';
import { createHelmetMiddleware } from '@task1/shared/security/helmet.config';
import { type Logger } from 'pino';

import { AppModule } from './app.module.js';
import appConfig from './config/app.config.js';
import { applyRequestContext } from './request-context.setup.js';
import { applySwagger } from './swagger.setup.js';

async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;

  try {
    app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });

    const loggerService = app.get(LoggerService);
    const pinoLogger = app.get<Logger>(PINO_LOGGER);
    const bootstrapLogger = loggerService.getLogger('Nest', 'bootstrap');
    app.useLogger(new NestLoggerBridge(bootstrapLogger, pinoLogger));

    applyRequestContext(app);
    app.use(createHelmetMiddleware());

    app.setGlobalPrefix('api');

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    app.enableShutdownHooks();

    const documentationMounted = applySwagger(app);

    const { port } = appConfig();
    await app.listen(port);

    bootstrapLogger.info({ documentationMounted }, 'API documentation availability resolved');

    // Bootstrap is over. Everything Nest logs from here on — unhandled errors surfaced by
    // GlobalExceptionFilter, shutdown notices — belongs to request handling, not to startup, so
    // it must not keep the "bootstrap" channel.
    app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'http'), pinoLogger));
  } catch (error) {
    if (app === undefined) {
      // eslint-disable-next-line n/no-process-exit -- no DI container available yet to resolve CentralizedErrorHandlerService
      process.exit(1);
    }

    app.get(CentralizedErrorHandlerService).handleError(new FatalError(error));
  }
}

await bootstrap();
