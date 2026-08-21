import { randomUUID } from 'node:crypto';

import { type CorrelationIdSource } from './request-context.types.js';

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
