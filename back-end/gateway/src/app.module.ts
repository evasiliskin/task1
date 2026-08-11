import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig, rabbitmqConfig] }),
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
