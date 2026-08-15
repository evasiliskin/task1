export const REDACT_CENSOR = '[REDACTED]' as const;

/**
 * The single source of truth for "this key is sensitive wherever it appears".
 *
 * Entries are compared after normalization (lowercased, non-alphanumerics stripped), so
 * `x-api-key`, `X_API_KEY` and `xApiKey` all match the single entry `xapikey`.
 */
export const SENSITIVE_KEYS: readonly string[] = [
  'authorization',
  'proxyauthorization',
  'authentication',
  'cookie',
  'setcookie',
  'xapikey',
  'apikey',
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'secret',
  'clientsecret',
  'privatekey',
  'sessionid',
  'ssn',
];

const NORMALIZED_SENSITIVE_KEYS: ReadonlySet<string> = new Set(SENSITIVE_KEYS);

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  return NORMALIZED_SENSITIVE_KEYS.has(normalizeKey(key));
}

/**
 * Pino `redact.paths`. Pino matches paths literally (with one-level `*` wildcards) — it does not
 * recurse — so these must mirror the shapes this application actually emits. The deep, recursive
 * pass lives in `redactLogPayload`, which `AppLogger` applies to every field object; these paths
 * are the belt-and-braces layer for anything that reaches pino by another route.
 */
export const REDACT_PATHS: readonly string[] = [
  'request.headers.authorization',
  'request.headers.cookie',
  'request.headers["x-api-key"]',
  'request.headers["proxy-authorization"]',

  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'clientSecret',
  'privateKey',
  'sessionId',

  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  '*.clientSecret',
  '*.privateKey',
  '*.sessionId',
];
