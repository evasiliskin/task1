import { isSensitiveKey, REDACT_CENSOR } from './redact-paths.js';

const MAX_DEPTH = 10;

const CIRCULAR_PLACEHOLDER = '[Circular]' as const;
const MAX_DEPTH_PLACEHOLDER = '[MaxDepthExceeded]' as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === null || prototype === Object.prototype;
}

/**
 * Whether cloning is worth it. The overwhelming majority of log payloads are shallow objects of
 * ids, counts and durations with nothing to redact, and this runs for every line that will be
 * written — so the scan (no allocation) decides whether to pay for the walk (allocates at every
 * level). Circular and over-deep structures return `true` so `deepRedact` can install its
 * placeholders.
 */
function needsRedaction(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (depth > MAX_DEPTH) {
    return true;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return true;
    }

    seen.add(value);

    return value.some((item) => needsRedaction(item, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return true;
    }

    seen.add(value);

    return Object.entries(value).some(
      ([key, inner]) => isSensitiveKey(key) || needsRedaction(inner, depth + 1, seen),
    );
  }

  return false;
}

function deepRedact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > MAX_DEPTH) {
    return MAX_DEPTH_PLACEHOLDER;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR_PLACEHOLDER;
    }

    seen.add(value);

    return value.map((item) => deepRedact(item, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return CIRCULAR_PLACEHOLDER;
    }

    seen.add(value);

    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) =>
        isSensitiveKey(key)
          ? ([key, REDACT_CENSOR] as const)
          : ([key, deepRedact(inner, depth + 1, seen)] as const),
      ),
    );
  }

  return value;
}

export function redactLogPayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  return needsRedaction(value, 0, new WeakSet<object>())
    ? deepRedact(value, 0, new WeakSet<object>())
    : value;
}
