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
