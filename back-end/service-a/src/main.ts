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

async function bootstrap(): Promise<void> {
  let app: INestMicroservice | undefined;

  try {
    const { url, queue, prefetchCount } = rabbitmqConfig();

    app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
      transport: Transport.RMQ,
      options: {
        urls: [url],
        queue,
        queueOptions: { durable: true },
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
