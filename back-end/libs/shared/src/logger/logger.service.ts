import { Inject, Injectable } from '@nestjs/common';
import { type Logger } from 'pino';

import { AppLogger } from './app-logger.js';
import { type ILoggerFactory } from './logger-factory.interface.js';
import { LOG_CHANNEL, PINO_LOGGER } from './logger.tokens.js';
import { type LogChannel } from './types.js';

/**
 * The one logger factory. Which transport a service runs on is expressed by the injected
 * `LOG_CHANNEL` default, not by having two classes with the same name in two directories.
 */
@Injectable()
export class LoggerService implements ILoggerFactory {
  public constructor(
    @Inject(PINO_LOGGER) private readonly pinoLogger: Logger,
    @Inject(LOG_CHANNEL) private readonly defaultChannel: LogChannel,
  ) {}

  public getLogger(source: string, channel: LogChannel = this.defaultChannel): AppLogger {
    return AppLogger.create(this.pinoLogger, source, channel);
  }
}
