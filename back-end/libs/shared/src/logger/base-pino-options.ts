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
    // pino's default emits the numeric level (30, 50, …). Aggregators need an explicit mapping to
    // make `level="error"` queries work, and a raw `docker logs` tail during an incident is far
    // easier to scan with labels. Verified to work alongside both the buffered destination and the
    // pino-pretty worker transport.
    formatters: {
      level: (label) => ({ level: label }),
    },
    // pino's default base is { pid, hostname }; both are repeated here because setting `base`
    // replaces it wholesale, and losing them would make a log line harder to trace to a container.
    base: { pid: process.pid, hostname: hostname(), service: config.serviceName },
    // Stamps correlationId, requestId and correlationIdSource onto every line, including lines
    // emitted from code that has no idea a request is in flight. Returns the live store by
    // reference to avoid a clone on every written line.
    mixin: () => requestContextService.getStoreForLogging(),
    // pino's default mixinMergeStrategy does `Object.assign(mixinObject, mergeObject)` — it
    // mutates whatever `mixin()` returned. Since `mixin` above returns the live AsyncLocalStorage
    // store (or a frozen shared empty object) by reference rather than a fresh clone, the default
    // strategy would either corrupt the request context with per-line log fields or throw on a
    // frozen target. Skip the merge entirely — and the allocation — when the caller passed no
    // fields; otherwise merge into a new object, never the shared one.
    mixinMergeStrategy: (mergeObject: object, mixinObject: object) =>
      Object.keys(mergeObject).length === 0 ? mixinObject : { ...mixinObject, ...mergeObject },
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
