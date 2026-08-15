import { type Logger } from 'pino';

import { redactLogPayload } from './redact-payload.js';
import { type LogChannel, type LogFields, type LogLevelName } from './types.js';

export class AppLogger {
  /**
   * Derives an operation-scoped logger. Every line from the result carries `bindings`, which is
   * how a whole business operation becomes followable by e.g. `importId` without threading the
   * value through every call site.
   */
  public with(bindings: LogFields): AppLogger {
    return new AppLogger(this.pinoLogger.child(redactLogPayload(bindings) as LogFields));
  }

  public isLevelEnabled(level: LogLevelName): boolean {
    return this.pinoLogger.isLevelEnabled(level);
  }

  public trace(fields: LogFields, message: string): void {
    this.write('trace', fields, message);
  }

  public debug(fields: LogFields, message: string): void {
    this.write('debug', fields, message);
  }

  public info(fields: LogFields, message: string): void {
    this.write('info', fields, message);
  }

  public warn(fields: LogFields, message: string, error?: unknown): void {
    this.write('warn', fields, message, error);
  }

  public error(fields: LogFields, message: string, error?: unknown): void {
    this.write('error', fields, message, error);
  }

  public fatal(fields: LogFields, message: string, error?: unknown): void {
    this.write('fatal', fields, message, error);
  }

  /**
   * Binds `source` and `channel` once, via a pino child logger, rather than re-spreading them onto
   * every call's merge object.
   */
  public static create(root: Logger, source: string, channel: LogChannel): AppLogger {
    return new AppLogger(root.child({ source, channel }));
  }

  private constructor(private readonly pinoLogger: Logger) {}

  /**
   * Redaction happens here, not at the call site, so no caller can forget it — but it is a deep
   * clone, so it must never run for a line that will be discarded. The level check comes first:
   * raising the level under load then sheds the serialization cost, not just the output. `err` is
   * attached after redaction; pino's `err` serializer handles it and it must not be deep-cloned.
   */
  private write(level: LogLevelName, fields: LogFields, message: string, error?: unknown): void {
    if (!this.pinoLogger.isLevelEnabled(level)) {
      return;
    }

    const redacted = redactLogPayload(fields) as Record<string, unknown>;

    // eslint-disable-next-line security/detect-object-injection -- level is a constrained LogLevelName, not user input
    this.pinoLogger[level](error === undefined ? redacted : { ...redacted, err: error }, message);
  }
}
