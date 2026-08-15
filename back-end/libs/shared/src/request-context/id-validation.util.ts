import { randomUUID } from 'node:crypto';

import { type CorrelationIdSource } from './request-context.types.js';

/**
 * Inbound ids must be UUIDs.
 *
 * The previous printable-ASCII check blocked header and log injection, which is the security
 * floor, but it still let an unauthenticated caller pick any 200-character string as the
 * correlation id for a whole request tree — enough to collapse traces into one unqueryable bucket
 * or to deliberately collide with someone else's. Every id this system mints is a UUID, so
 * requiring the same shape on the wire costs legitimate callers nothing. Accepts v1–v8 and the
 * nil/max variants that some gateways emit.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IResolvedId {
  value: string;
  source: CorrelationIdSource;
}

export function resolveIdWithSource(raw: string | string[] | undefined): IResolvedId {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate !== 'string') {
    return { value: randomUUID(), source: 'generated' };
  }

  const trimmed = candidate.trim();

  if (!UUID_PATTERN.test(trimmed)) {
    return { value: randomUUID(), source: 'generated' };
  }

  return { value: trimmed, source: 'inbound' };
}

export function resolveId(raw: string | string[] | undefined): string {
  return resolveIdWithSource(raw).value;
}
