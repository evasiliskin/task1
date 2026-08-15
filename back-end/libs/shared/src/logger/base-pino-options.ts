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
    // pino's default base is { pid, hostname }; both are repeated here because setting `base`
    // replaces it wholesale, and losing them would make a log line harder to trace to a container.
    base: { pid: process.pid, hostname: hostname(), service: config.serviceName },
    // Stamps correlationId, requestId and correlationIdSource onto every line, including lines
    // emitted from code that has no idea a request is in flight.
    mixin: () => requestContextService.getAttributes(),
    timestamp: pino.stdTimeFunctions.isoTime,
    // 'err' is pino's default error key; naming it explicitly documents the contract that log
    // aggregators and `serializeError` both rely on.
    errorKey: 'err',
    serializers: { err: serializeError },
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    transport:
      config.transport === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
  };
}
