export type LogChannel = 'http' | 'rmq' | 'bootstrap';

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Free-form structured fields for one log line.
 *
 * `error`/`err` are banned at the type level: an `Error` under an ordinary key is serialized by
 * `JSON.stringify` to `{}` — message and stack silently vanish. Errors go through the third
 * argument of `warn`/`error`/`fatal`, which routes them to pino's `err` serializer.
 */
export type LogFields = Record<string, unknown> & { error?: never; err?: never };
