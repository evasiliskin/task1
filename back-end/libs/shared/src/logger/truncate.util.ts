export const MAX_LOGGED_PAYLOAD_BYTES = 2048;

/**
 * Caps a free-form payload before it reaches the log stream. An oversized body is replaced with a
 * marker rather than sliced: a half-serialized object is misleading, while an explicit
 * `{ truncated: true }` tells the reader exactly what happened.
 */
export function truncateForLog(value: unknown, maxBytes = MAX_LOGGED_PAYLOAD_BYTES): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    return value;
  }

  const byteLength = Buffer.byteLength(serialized, 'utf8');

  return byteLength <= maxBytes ? value : { truncated: true, approximateBytes: byteLength };
}
