import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NestLoggerBridge } from '@task1/shared/logger/nest-logger.bridge';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';

import { AppModule } from './app.module';
import rabbitmqConfig from './config/rabbitmq.config';

async function bootstrap(): Promise<void> {
  const { url, queue } = rabbitmqConfig();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: { durable: true },
    },
    bufferLogs: true,
  });

  const loggerService = app.get(LoggerService);
  const bootstrapLogger = loggerService.getLogger('Nest', 'bootstrap');
  app.useLogger(new NestLoggerBridge(bootstrapLogger));

  try {
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.listen();
  } catch (error) {
    bootstrapLogger.fatal(
      { error: error instanceof Error ? error.message : String(error) },
      'Application bootstrap failed',
    );

    throw error;
  }
}

bootstrap().catch(() => {
  process.exitCode = 1;
});
