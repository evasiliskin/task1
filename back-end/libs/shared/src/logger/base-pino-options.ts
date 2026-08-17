import { hostname } from 'node:os';

import { pino, type LoggerOptions } from 'pino';

import { type ILoggerConfiguration } from '../config/logger.config.js';
import { type RequestContextService } from '../request-context/request-context.service.js';

import { serializeError } from './error.serializer.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redact-paths.js';

export function buildBasePinoOptions(
  config: ILoggerConfiguration,
  requestContextService: RequestContextService,
): LoggerOptions {
  return {
    level: config.level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: { pid: process.pid, hostname: hostname(), service: config.serviceName },
    mixin: () => requestContextService.getStoreForLogging(),
    mixinMergeStrategy: (mergeObject: object, mixinObject: object) =>
      Object.keys(mergeObject).length === 0 ? mixinObject : { ...mixinObject, ...mergeObject },
    timestamp: pino.stdTimeFunctions.isoTime,
    errorKey: 'err',
    serializers: { err: serializeError },
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    transport:
      config.transport === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
  };
}
