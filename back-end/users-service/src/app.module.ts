import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [rabbitmqConfig] }),
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
