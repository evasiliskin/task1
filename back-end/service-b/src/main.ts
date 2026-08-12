import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import rabbitmqConfig from './config/rabbitmq.config';
import { LoggerService } from './core/logger/logger.service';
import { NestLoggerBridge } from './core/logger/nest-logger.bridge';

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
  app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap')));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
