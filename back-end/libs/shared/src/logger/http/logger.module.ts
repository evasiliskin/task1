import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import loggerConfig from '../../config/logger.config.js';
import { RequestContextModule } from '../../request-context/http/request-context.module.js';
import { RequestContextService } from '../../request-context/request-context.service.js';

import { HttpLoggingMiddleware } from './http-logging.middleware.js';
import { LoggerService } from './logger.service.js';
import { pinoConfigFactory } from './pino-config.factory.js';

@Module({
  imports: [
    RequestContextModule,
    PinoLoggerModule.forRootAsync({
      inject: [loggerConfig.KEY, RequestContextService],
      useFactory: (
        config: ConfigType<typeof loggerConfig>,
        requestContextService: RequestContextService,
      ) => pinoConfigFactory(config, requestContextService),
    }),
  ],
  providers: [LoggerService, HttpLoggingMiddleware],
  exports: [LoggerService],
})
export class LoggerModule implements NestModule {
  // Applied after RequestContextMiddleware: RequestContextModule is registered first, both as an
  // import of the consuming AppModule and as an import of this module.
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HttpLoggingMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
