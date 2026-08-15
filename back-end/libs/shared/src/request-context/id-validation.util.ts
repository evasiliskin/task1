import { randomUUID } from 'node:crypto';

import { type CorrelationIdSource, MAX_ID_LENGTH } from './request-context.types.js';

// Printable ASCII, no whitespace/control chars - blocks header/log injection
// via a spoofed id while still allowing non-UUID correlation ids from clients.
const SAFE_ID_PATTERN = /^[\x21-\x7E]+$/;

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

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(trimmed)) {
    return { value: randomUUID(), source: 'generated' };
  }

  return { value: trimmed, source: 'inbound' };
}

export function resolveId(raw: string | string[] | undefined): string {
  return resolveIdWithSource(raw).value;
}
