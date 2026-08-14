import { type LoggerService, type LogLevel } from '@nestjs/common';

import { type AppLogger } from './app-logger.js';

export class NestLoggerBridge implements LoggerService {
  public constructor(private readonly logger: AppLogger) {}

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info({ context: optionalParameters[0] }, String(message));
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.error(
      { context: optionalParameters[1], trace: optionalParameters[0] },
      String(message),
    );
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn({ context: optionalParameters[0] }, String(message));
  }

  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug({ context: optionalParameters[0] }, String(message));
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace({ context: optionalParameters[0] }, String(message));
  }

  public fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.fatal({ context: optionalParameters[0] }, String(message));
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- the transport-specific logger (pino-http / raw pino) controls the active level; Nest's setLogLevels() has no effect here.
  public setLogLevels(_levels: LogLevel[]): void {}
}
