export type LogChannel = 'http' | 'rmq' | 'bootstrap';

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Free-form structured fields for one log line.
 *
 * `error`/`err` are banned at the type level: an `Error` under an ordinary key is serialized by
 * `JSON.stringify` to `{}` — message and stack silently vanish. Errors go through the third
 * argument of `warn`/`error`/`fatal`, which routes them to pino's `err` serializer.
 *
 * The remaining keys are banned because pino writes `base` and `child()` bindings into the line
 * as a pre-serialized string and does NOT deduplicate them against the merge object. A field
 * reusing one of those names emits the key twice in the same JSON object; every parser keeps the
 * last occurrence, so the binding's value is silently replaced. See pino's api.md, "Manage tags
 * with mixin and child loggers". The pino `mixin` is unaffected — pino `Object.assign`s it with
 * the merge object — so `correlationId`/`requestId` are safe to pass explicitly.
 */
export type LogFields = Record<string, unknown> & {
  error?: never;
  err?: never;
  source?: never;
  channel?: never;
  service?: never;
  pid?: never;
  hostname?: never;
  level?: never;
  time?: never;
  msg?: never;
};
