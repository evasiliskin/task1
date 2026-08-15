import { resolveId, resolveIdWithSource } from './id-validation.util.js';
import {
  CORRELATION_ID_HEADER,
  type IRequestContext,
  REQUEST_ID_HEADER,
} from './request-context.types.js';

/**
 * Resolves the correlation-id and request-id headers into an `IRequestContext`. The one place
 * both the HTTP Express middleware and the RMQ context interceptor derive their context from —
 * previously duplicated in both, so a change to one could silently diverge from the other.
 */
export function resolveRequestContext(
  headers: Record<string, string | string[] | undefined>,
): IRequestContext {
  // eslint-disable-next-line security/detect-object-injection
  const correlation = resolveIdWithSource(headers[CORRELATION_ID_HEADER]);
  // eslint-disable-next-line security/detect-object-injection
  const requestId = resolveId(headers[REQUEST_ID_HEADER]);

  return { correlationId: correlation.value, requestId, correlationIdSource: correlation.source };
}
