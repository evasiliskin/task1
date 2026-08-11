import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig, rabbitmqConfig],
    }),
    RequestContextModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
