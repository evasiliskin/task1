import { type LogChannel, type LogFields } from './types.js';

export interface IPinoLikeLogger {
  trace(fields: LogFields, message: string): void;
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  fatal(fields: LogFields, message: string): void;
}

export class AppLogger {
  public constructor(
    private readonly pinoLogger: IPinoLikeLogger,
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

  public warn(fields: LogFields, message: string): void {
    this.pinoLogger.warn({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public error(fields: LogFields, message: string): void {
    this.pinoLogger.error({ ...fields, source: this.source, channel: this.channel }, message);
  }

  public fatal(fields: LogFields, message: string): void {
    this.pinoLogger.fatal({ ...fields, source: this.source, channel: this.channel }, message);
  }
}
