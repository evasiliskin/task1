import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import appConfig from './config/app.config';
import { LoggerService } from './core/logger/logger.service';
import { NestLoggerBridge } from './core/logger/nest-logger.bridge';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const loggerService = app.get(LoggerService);
  app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap')));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const { port } = appConfig();
  await app.listen(port);
}

bootstrap().catch(() => {
  process.exitCode = 1;
});
