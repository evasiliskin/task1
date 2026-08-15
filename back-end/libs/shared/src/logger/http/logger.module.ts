import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';

import { RequestContextMiddleware } from '../../request-context/http/request-context.middleware.js';
import { RequestContextModule } from '../../request-context/http/request-context.module.js';
import { LoggerCoreModule } from '../logger-core.module.js';

import { HttpLoggingMiddleware } from './http-logging.middleware.js';

@Module({
  imports: [RequestContextModule, LoggerCoreModule.forChannel('http')],
  providers: [RequestContextMiddleware, HttpLoggingMiddleware],
  exports: [LoggerCoreModule],
})
export class LoggerModule implements NestModule {
  // Order is explicit and local: HttpLoggingMiddleware must see the correlation id that
  // RequestContextMiddleware puts in the ALS store. Previously this depended on the position of
  // RequestContextModule in the consuming AppModule's imports array — a silently breakable
  // coupling that no test covered.
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, HttpLoggingMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
