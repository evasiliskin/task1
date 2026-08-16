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
