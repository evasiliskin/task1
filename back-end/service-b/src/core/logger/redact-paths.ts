// Single source of truth for sensitive log paths, passed to pino's `redact` option
// so secrets never reach stdout/log storage, regardless of what a caller logs.
export const REDACT_CENSOR = '[REDACTED]' as const;

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',

  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',

  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
] as const;

export type RedactPath = (typeof REDACT_PATHS)[number];
