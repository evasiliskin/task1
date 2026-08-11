import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { CorrelationIdMiddleware } from './core/middleware/correlation-id.middleware';
import { HealthController } from './health/health.controller';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ExceptionHandlingModule, UsersModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
