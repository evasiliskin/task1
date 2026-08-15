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

/**
 * Bridges Nest's own `LoggerService` interface onto `AppLogger`.
 *
 * `source` is a pino child binding and is fixed to `'Nest'` for every line this bridge writes —
 * a per-line override would emit the key twice (see `LogFields`). Nest's own context (the class
 * that logged) therefore lands in `nestContext`: `source:"Nest"` selects every framework line,
 * `nestContext` narrows within them.
 */
export class NestLoggerBridge implements LoggerService {
  public constructor(
    private readonly logger: AppLogger,
    private readonly pinoLogger?: Logger,
  ) {}

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info({ nestContext: optionalParameters[0] }, String(message));
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    // Nest hands the stack in as a pre-formatted string, not an Error, so there is nothing for the
    // `err` serializer to walk — `stack` is the honest name for what this actually is. `trace`
    // meant distributed-trace id to every aggregator that read it.
    this.logger.error(
      { nestContext: optionalParameters[1], stack: optionalParameters[0] },
      String(message),
    );
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn({ nestContext: optionalParameters[0] }, String(message));
  }

  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug({ nestContext: optionalParameters[0] }, String(message));
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace({ nestContext: optionalParameters[0] }, String(message));
  }

  public fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.fatal({ nestContext: optionalParameters[0] }, String(message));
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
