import { stdSerializers } from 'pino';

import { AppError } from '../errors/index.js';

export const MAX_CAUSE_DEPTH = 5;

/**
 * Pino's `err` serializer. Registered under `serializers.err` so the standard `errorKey` ('err')
 * carries a complete, machine-readable error — including the `cause` chain and this codebase's
 * `AppError` taxonomy, both of which a plain `{ message, stack }` flattening throws away.
 */
function appErrorFields(error: Error): Record<string, unknown> {
  return error instanceof AppError
    ? {
        code: error.code,
        category: error.category,
        ...(error.path !== undefined && { path: [...error.path] }),
        ...(error.params !== undefined && { params: { ...error.params } }),
      }
    : {};
}

/**
 * Serializes a `.cause` at `depth > 0`. Deliberately does NOT call `stdSerializers.err()`: that
 * serializer folds an error's entire downstream `.cause` chain into its own `message`/`stack`
 * text, so calling it again at every recursion level would re-fold (and duplicate) the same
 * downstream content that a shallower level's `message`/`stack` already captured. Using the raw
 * `error.message`/`error.stack` instead keeps each level's own text, while the `AppError`
 * taxonomy (code/category/path/params) and further nested `cause` are still walked explicitly.
 */
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

  // Only the top-level error is run through pino's `stdSerializers.err()`: that gives one
  // fully-folded, human-readable `message`/`stack` combining the whole chain. Nested `cause`
  // levels below it use `serializeCause`, which avoids re-folding the same downstream text.
  const base = stdSerializers.err(error) as Record<string, unknown>;

  return {
    ...base,
    ...appErrorFields(error),
    ...(error.cause !== undefined && { cause: serializeCause(error.cause, depth + 1) }),
  };
}
