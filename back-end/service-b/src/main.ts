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

// `tmpdir()` resolves to `/tmp` in the container (matching the Dockerfile HEALTHCHECK's hard-coded
// path) but to a real per-platform temp directory in local dev — a hard-coded '/tmp' resolves to
// `<drive>:\tmp` on Windows, which may not exist and would otherwise crash bootstrap.
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

    // A file the container healthcheck can stat. `listen()` has resolved, so the listener is
    // consuming and every OnApplicationBootstrap hook has run — which is the thing a healthcheck
    // should assert, and precisely what connecting to the broker from outside cannot.
    // Non-fatal: a diagnostic marker failing to write should leave the container correctly
    // unhealthy, not crash a process whose RMQ listener is otherwise up and consuming.
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- READINESS_MARKER_PATH is built from os.tmpdir() and a fixed filename, never from request/user input
      await writeFile(READINESS_MARKER_PATH, new Date().toISOString(), 'utf8');
    } catch (markerError) {
      bootstrapLogger.warn({}, 'Failed to write readiness marker', markerError);
    }

    // Bootstrap is over. Everything Nest logs from here on — unhandled errors surfaced by
    // RpcExceptionFilter, shutdown notices — belongs to message handling, not to startup, so it
    // must not keep the "bootstrap" channel.
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
