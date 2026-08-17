import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestMicroservice } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { FatalError } from '@task1/shared/errors/internal/fatal-error';
import { CentralizedErrorHandlerService } from '@task1/shared/exception-handling/centralized-error-handler.service';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { PINO_LOGGER } from '@task1/shared/logger/logger.tokens';
import { NestLoggerBridge } from '@task1/shared/logger/nest-logger.bridge';
import { type Logger } from 'pino';

import { AppModule } from './app.module.js';
import rabbitmqConfig from './config/rabbitmq.config.js';

const READINESS_MARKER_PATH = join(tmpdir(), 'service-ready');

async function bootstrap(): Promise<void> {
  let app: INestMicroservice | undefined;

  try {
    const { url, queue, prefetchCount } = rabbitmqConfig();

    app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
      transport: Transport.RMQ,
      options: {
        urls: [url],
        queue,
        queueOptions: {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': `${queue}.dlq`,
          },
        },
        noAck: false,
        prefetchCount,
      },
      bufferLogs: true,
    });

    const loggerService = app.get(LoggerService);
    const pinoLogger = app.get<Logger>(PINO_LOGGER);
    const bootstrapLogger = loggerService.getLogger('Nest', 'bootstrap');
    app.useLogger(new NestLoggerBridge(bootstrapLogger, pinoLogger));

    app.enableShutdownHooks();

    await app.listen();

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- READINESS_MARKER_PATH is built from os.tmpdir() and a fixed filename, never from request/user input
      await writeFile(READINESS_MARKER_PATH, new Date().toISOString(), 'utf8');
    } catch (markerError) {
      bootstrapLogger.warn({}, 'Failed to write readiness marker', markerError);
    }

    app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'rmq'), pinoLogger));
  } catch (error) {
    if (app === undefined) {
      // eslint-disable-next-line n/no-process-exit -- no DI container available yet to resolve CentralizedErrorHandlerService
      process.exit(1);
    }

    app.get(CentralizedErrorHandlerService).handleError(new FatalError(error));
  }
}

await bootstrap();
