import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import loggerConfig from './config/logger.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { LoggerModule } from './core/logger/logger.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
