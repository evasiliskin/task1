import { type LoggerOptions } from 'pino';

import { type ILoggerConfiguration } from '../config/logger.config.js';
import { type RequestContextService } from '../request-context/request-context.service.js';

import { REDACT_CENSOR, REDACT_PATHS } from './redact-paths.js';

export function buildBasePinoOptions(
  config: ILoggerConfiguration,
  requestContextService: RequestContextService,
): LoggerOptions {
  return {
    level: config.level,
    mixin: () => requestContextService.getAttributes(),
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    transport:
      config.transport === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
  };
}
