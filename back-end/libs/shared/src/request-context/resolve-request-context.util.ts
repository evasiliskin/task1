import { resolveId, resolveIdWithSource } from './id-validation.util.js';
import {
  CORRELATION_ID_HEADER,
  type IRequestContext,
  REQUEST_ID_HEADER,
} from './request-context.types.js';

export function resolveRequestContext(
  headers: Record<string, string | string[] | undefined>,
): IRequestContext {
  // eslint-disable-next-line security/detect-object-injection
  const correlation = resolveIdWithSource(headers[CORRELATION_ID_HEADER]);
  // eslint-disable-next-line security/detect-object-injection
  const requestId = resolveId(headers[REQUEST_ID_HEADER]);

  return { correlationId: correlation.value, requestId, correlationIdSource: correlation.source };
}
