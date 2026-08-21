import { stdSerializers } from 'pino';

import { AppError } from '../errors/index.js';

import { redactLogPayload } from './redact-payload.js';
import { truncateForLog } from './truncate.util.js';

export const MAX_CAUSE_DEPTH = 5;

const MAX_ERROR_PARAMS_BYTES = 2048;

function appErrorFields(error: Error): Record<string, unknown> {
  return error instanceof AppError
    ? {
        code: error.code,
        category: error.category,
        ...(error.path !== undefined && { path: [...error.path] }),
        ...(error.params !== undefined && {
          params: truncateForLog(redactLogPayload({ ...error.params }), MAX_ERROR_PARAMS_BYTES),
        }),
      }
    : {};
}

function serializeCause(error: unknown, depth: number): unknown {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  if (depth > MAX_CAUSE_DEPTH) {
    return { message: '[MaxCauseDepthExceeded]' };
  }

  return {
    type: error.name,
    message: error.message,
    stack: error.stack,
    ...appErrorFields(error),
    ...(error.cause !== undefined && { cause: serializeCause(error.cause, depth + 1) }),
  };
}

export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  if (depth > MAX_CAUSE_DEPTH) {
    return { message: '[MaxCauseDepthExceeded]' };
  }

  const base = stdSerializers.err(error) as Record<string, unknown>;

  return {
    ...base,
    ...appErrorFields(error),
    ...(error.cause !== undefined && { cause: serializeCause(error.cause, depth + 1) }),
  };
}
