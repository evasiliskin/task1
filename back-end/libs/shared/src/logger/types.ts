export type LogChannel = 'http' | 'rmq' | 'bootstrap';

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

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
