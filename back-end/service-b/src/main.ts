import { type INestMicroservice } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { FatalError } from '@task1/shared/errors/internal/fatal-error';
import { CentralizedErrorHandlerService } from '@task1/shared/exception-handling/centralized-error-handler.service';
import { NestLoggerBridge } from '@task1/shared/logger/nest-logger.bridge';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';

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
    const bootstrapLogger = loggerService.getLogger('Nest', 'bootstrap');
    app.useLogger(new NestLoggerBridge(bootstrapLogger));

    app.enableShutdownHooks();

    await app.listen();
  } catch (error) {
    if (app === undefined) {
      // eslint-disable-next-line n/no-process-exit -- no DI container available yet to resolve CentralizedErrorHandlerService
      process.exit(1);
    }

    app.get(CentralizedErrorHandlerService).handleError(new FatalError(error));
  }
}

await bootstrap();
