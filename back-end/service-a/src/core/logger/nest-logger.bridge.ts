import { type LoggerService, type LogLevel } from '@nestjs/common';

import { type AppLogger } from './app-logger';

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
    this.logger.error({ context: optionalParameters[0], fatal: true }, String(message));
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- required by the LoggerService contract; this service has no dynamic log-level switching
  public setLogLevels(_levels: LogLevel[]): void {}
}
