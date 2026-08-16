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

// `tmpdir()` resolves to `/tmp` in the container (matching the Dockerfile HEALTHCHECK's hard-coded
// path) but to a real per-platform temp directory in local dev — a hard-coded '/tmp' resolves to
// `<drive>:\tmp` on Windows, which may not exist and would otherwise crash bootstrap.
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

    // A single application hosting two RMQ listeners. Imports run for minutes and hold their
    // prefetch slot until they finish; RPCs must answer in milliseconds. Sharing one queue means
    // the second workload waits behind the first, so each gets its own queue and prefetch budget.
    //
    // connectMicroservice/startAllMicroservices only exist on INestApplication (Nest's hybrid-app
    // API), not on the INestApplicationContext returned by createApplicationContext, so this uses
    // NestFactory.create(). No HTTP port is ever opened (listen() is never called) — service-a
    // stays RabbitMQ-only; the HTTP adapter is instantiated but unused.
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

    // startAllMicroservices() only calls listen() on each connected microservice — it does not run
    // the shared container's onModuleInit/onApplicationBootstrap hooks (that's normally listen()'s
    // job, and we never call listen() since there's no HTTP server). init() must be called
    // explicitly so MongoConnectionService/RedisConnectionService connect and
    // QueueTopologyInitializer declares the retry/DLQ queues before either listener starts
    // consuming.
    await application.init();
    await application.startAllMicroservices();

    // A file the container healthcheck can stat. `startAllMicroservices()` has resolved, so both
    // listeners are consuming and every OnApplicationBootstrap hook has run — which is the thing a
    // healthcheck should assert, and precisely what connecting to the broker from outside cannot.
    // Non-fatal: a diagnostic marker failing to write should leave the container correctly
    // unhealthy, not crash a process whose RMQ listeners are otherwise up and consuming.
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
