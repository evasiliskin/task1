import { type LogChannel, type LogFields } from './types.js';

export interface IAppLogger {
  trace(fields: LogFields, message: string): void;
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  fatal(fields: LogFields, message: string): void;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AppLogger {
  public constructor(
    private readonly pinoLogger: IAppLogger,
    private readonly source: string,
    private readonly channel: LogChannel,
  ) {}

  public trace(fields: LogFields, message: string): void {
    this.pinoLogger.trace({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public debug(fields: LogFields, message: string): void {
    this.pinoLogger.debug({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public info(fields: LogFields, message: string): void {
    this.pinoLogger.info({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public warn(fields: LogFields, message: string, error?: unknown): void {
    this.pinoLogger.warn(this.buildFields(fields, error), message);
  }

  public error(fields: LogFields, message: string, error?: unknown): void {
    this.pinoLogger.error(this.buildFields(fields, error), message);
  }

  public fatal(fields: LogFields, message: string, error?: unknown): void {
    this.pinoLogger.fatal(this.buildFields(fields, error), message);
  }

  private buildFields(fields: LogFields, error: unknown): LogFields {
    const errorField = error === undefined ? {} : { error: formatError(error) };

    return { ...fields, ...errorField, source: this.source, channel: this.channel };
  }
}
