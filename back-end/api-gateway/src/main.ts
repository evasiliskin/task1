import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggerService } from '@task1/shared/logger/http/logger.service';
import { NestLoggerBridge } from '@task1/shared/logger/nest-logger.bridge';

import { AppModule } from './app.module';
import appConfig from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

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

    const swaggerConfig = new DocumentBuilder().setTitle('Gateway API').setVersion('1.0').build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api-docs', app, swaggerDocument);

    const { port } = appConfig();
    await app.listen(port);
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
