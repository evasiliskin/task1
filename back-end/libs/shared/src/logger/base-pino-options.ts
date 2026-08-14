import { hostname } from 'node:os';

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
    // pino's default base is { pid, hostname }; both are repeated here because setting `base`
    // replaces it wholesale, and losing them would make a log line harder to trace to a container.
    base: { pid: process.pid, hostname: hostname(), service: config.serviceName },
    mixin: () => requestContextService.getAttributes(),
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    transport:
      config.transport === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
  };
}
