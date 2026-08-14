import { type Params } from 'nestjs-pino';

import { type ILoggerConfiguration } from '../../config/logger.config.js';
import { type RequestContextService } from '../../request-context/request-context.service.js';
import { REDACT_CENSOR, REDACT_PATHS } from '../redact-paths.js';

function isHealthCheckRequest(request: { url?: string }): boolean {
  return (request.url ?? '').includes('/health/');
}

export function pinoConfigFactory(
  config: ILoggerConfiguration,
  requestContextService: RequestContextService,
): Params {
  return {
    pinoHttp: {
      level: config.level,
      mixin: () => requestContextService.getAttributes(),
      redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
      autoLogging: { ignore: isHealthCheckRequest },
      transport:
        config.transport === 'pretty'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
    },
  };
}
