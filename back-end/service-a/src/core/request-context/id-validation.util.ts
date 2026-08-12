import { randomUUID } from 'node:crypto';

import { MAX_ID_LENGTH } from './request-context.types';

// Printable ASCII, no whitespace/control chars - blocks header/log injection
// via a spoofed id while still allowing non-UUID correlation ids from clients.
const SAFE_ID_PATTERN = /^[\x21-\x7E]+$/;

export function resolveId(raw: string | string[] | undefined): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate !== 'string') {
    return randomUUID();
  }

  const trimmed = candidate.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}
