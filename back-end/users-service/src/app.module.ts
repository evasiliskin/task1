import { Module } from '@nestjs/common';

import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ExceptionHandlingModule, HealthModule],
})
export class AppModule {}
