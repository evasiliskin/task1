import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication } from '@nestjs/common';
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

function buildRmqOptions(url: string, queue: string, prefetchCount: number): MicroserviceOptions {
  return {
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
  };
}

async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;

  try {
    const { url, queue, importsQueue, rpcPrefetch, importPrefetch } = rabbitmqConfig();

    const application = await NestFactory.create<INestApplication>(AppModule, { bufferLogs: true });

    application.connectMicroservice(buildRmqOptions(url, queue, rpcPrefetch), {
      inheritAppConfig: true,
    });
    application.connectMicroservice(buildRmqOptions(url, importsQueue, importPrefetch), {
      inheritAppConfig: true,
    });

    app = application;

    const loggerService = application.get(LoggerService);
    const pinoLogger = application.get<Logger>(PINO_LOGGER);
    application.useLogger(
      new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap'), pinoLogger),
    );

    application.enableShutdownHooks();

    await application.init();
    await application.startAllMicroservices();

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- READINESS_MARKER_PATH is built from os.tmpdir() and a fixed filename, never from request/user input
      await writeFile(READINESS_MARKER_PATH, new Date().toISOString(), 'utf8');
    } catch (markerError) {
      loggerService
        .getLogger('Bootstrap')
        .warn({}, 'Failed to write readiness marker', markerError);
    }

    application.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'rmq'), pinoLogger));
  } catch (error) {
    if (app === undefined) {
      // eslint-disable-next-line n/no-process-exit -- no DI container available yet to resolve CentralizedErrorHandlerService
      process.exit(1);
    }

    app.get(CentralizedErrorHandlerService).handleError(new FatalError(error));
  }
}

await bootstrap();
