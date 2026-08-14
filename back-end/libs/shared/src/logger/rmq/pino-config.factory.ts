import { type LoggerOptions } from 'pino';

import { type ILoggerConfiguration } from '../../config/logger.config.js';
import { type RequestContextService } from '../../request-context/request-context.service.js';
import { buildBasePinoOptions } from '../base-pino-options.js';

export function pinoConfigFactory(
  config: ILoggerConfiguration,
  requestContextService: RequestContextService,
): LoggerOptions {
  return {
    ...buildBasePinoOptions(config, requestContextService),
  };
}
