import { type LoggerService, type LogLevel } from '@nestjs/common';
import { type Logger } from 'pino';

import { type AppLogger } from './app-logger.js';

const NEST_TO_PINO_LEVEL: Record<LogLevel, string> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const PINO_LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export class NestLoggerBridge implements LoggerService {
  public constructor(
    private readonly logger: AppLogger,
    private readonly pinoLogger?: Logger,
  ) {}

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

  /**
   * Nest's level control and pino's must not drift. The lowest level Nest asks for becomes pino's
   * threshold; without a pino logger to act on, this is a no-op rather than a silent lie.
   */
  public setLogLevels(levels: LogLevel[]): void {
    if (this.pinoLogger === undefined || levels.length === 0) {
      return;
    }

    const mapped = levels
      // eslint-disable-next-line security/detect-object-injection -- keys come from Nest's closed LogLevel union.
      .map((level) => NEST_TO_PINO_LEVEL[level])
      .filter((level): level is string => level !== undefined);

    if (mapped.length === 0) {
      return;
    }

    const lowest = mapped.reduce((current, candidate) =>
      PINO_LEVEL_ORDER.indexOf(candidate) < PINO_LEVEL_ORDER.indexOf(current) ? candidate : current,
    );

    this.pinoLogger.level = lowest;
  }
}
