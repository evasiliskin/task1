export const MAX_LOGGED_PAYLOAD_BYTES = 2048;

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
