import { REDACT_CENSOR, REDACT_PATHS } from './redact-paths.js';

const MAX_DEPTH = 10;

const CIRCULAR_PLACEHOLDER = '[Circular]' as const;
const MAX_DEPTH_PLACEHOLDER = '[MaxDepthExceeded]' as const;

/**
 * Pino's `redact.paths` only censors the exact paths it is given, which is enough for the
 * fixed shape of a log line but not for free-form payloads such as a request body. The leaf
 * key of every configured path is reused here as a "this key is sensitive wherever it appears"
 * rule, so `REDACT_PATHS` stays the single source of truth for both mechanisms.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  REDACT_PATHS.map((path) => path.split('.').at(-1)?.toLowerCase()).filter(
    (key): key is string => key !== undefined && key !== '',
  ),
);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === null || prototype === Object.prototype;
}

/**
 * Deep-copies `value`, replacing every sensitive key with the shared censor. Cycles and
 * pathological nesting are collapsed into placeholders so a malicious payload cannot turn a
 * log call into an infinite loop.
 */
export function redactLogPayload(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
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

    return value.map((item) => redactLogPayload(item, depth + 1, seen));
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
          : ([key, redactLogPayload(inner, depth + 1, seen)] as const),
      ),
    );
  }

  return value;
}
