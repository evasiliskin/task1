import { Inject, Injectable } from '@nestjs/common';
import { type Logger } from 'pino';

import { AppLogger } from './app-logger.js';
import { type ILoggerFactory } from './logger-factory.interface.js';
import { LOG_CHANNEL, PINO_LOGGER } from './logger.tokens.js';
import { type LogChannel } from './types.js';

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
