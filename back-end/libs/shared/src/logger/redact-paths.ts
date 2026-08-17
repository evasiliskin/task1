export const REDACT_CENSOR = '[REDACTED]' as const;

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

  'err.params.password',
  'err.params.token',
  'err.params.apiKey',
  'err.params.secret',
  'err.cause.params.password',
  'err.cause.params.token',
  'err.cause.params.apiKey',
  'err.cause.params.secret',
];
