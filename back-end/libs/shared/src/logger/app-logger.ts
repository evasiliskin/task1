import { type Logger } from 'pino';

import { redactLogPayload } from './redact-payload.js';
import { type LogChannel, type LogFields, type LogLevelName } from './types.js';

export class AppLogger {
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

  public static create(root: Logger, source: string, channel: LogChannel): AppLogger {
    return new AppLogger(root.child({ source, channel }));
  }

  private constructor(private readonly pinoLogger: Logger) {}

  private write(level: LogLevelName, fields: LogFields, message: string, error?: unknown): void {
    if (!this.pinoLogger.isLevelEnabled(level)) {
      return;
    }

    const redacted = redactLogPayload(fields) as Record<string, unknown>;

    // eslint-disable-next-line security/detect-object-injection -- level is a constrained LogLevelName, not user input
    this.pinoLogger[level](error === undefined ? redacted : { ...redacted, err: error }, message);
  }
}
