import { type Params } from 'nestjs-pino';

import { type ILoggerConfiguration } from '../../config/logger.config.js';
import { type RequestContextService } from '../../request-context/request-context.service.js';
import { buildBasePinoOptions } from '../base-pino-options.js';

function isHealthCheckRequest(request: { url?: string }): boolean {
  return (request.url ?? '').includes('/health/');
}

export function pinoConfigFactory(
  config: ILoggerConfiguration,
  requestContextService: RequestContextService,
): Params {
  return {
    pinoHttp: {
      ...buildBasePinoOptions(config, requestContextService),
      autoLogging: { ignore: isHealthCheckRequest },
    },
  };
}
