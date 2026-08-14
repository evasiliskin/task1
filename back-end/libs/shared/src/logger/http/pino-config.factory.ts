import { type Params } from 'nestjs-pino';

import { type ILoggerConfiguration } from '../../config/logger.config.js';
import { type RequestContextService } from '../../request-context/request-context.service.js';
import { buildBasePinoOptions } from '../base-pino-options.js';

export function pinoConfigFactory(
  config: ILoggerConfiguration,
  requestContextService: RequestContextService,
): Params {
  return {
    pinoHttp: {
      ...buildBasePinoOptions(config, requestContextService),
      // Defence in depth: HttpLoggingMiddleware owns request logging, so even if pino-http's
      // middleware is ever mounted again (see `forRoutes` below) it must not emit a second
      // completion line of its own.
      autoLogging: false,
    },
    // nestjs-pino is used purely as a DI wrapper around a pino instance. Its middleware only adds
    // a per-request child logger bound to the serialized request, which would repeat the whole
    // request on every log line; correlation is already handled by RequestContextService and the
    // `mixin` in buildBasePinoOptions, so the middleware is mounted on no routes at all.
    forRoutes: [],
  };
}
