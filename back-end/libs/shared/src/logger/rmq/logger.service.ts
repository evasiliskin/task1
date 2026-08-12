import { Inject, Injectable } from '@nestjs/common';
import { type Logger } from 'pino';

import { AppLogger } from '../app-logger';
import { type LogChannel } from '../types';

import { PINO_LOGGER } from './pino-instance.token';

@Injectable()
export class LoggerService {
  public constructor(@Inject(PINO_LOGGER) private readonly pinoLogger: Logger) {}

  public getLogger(source: string, channel: LogChannel = 'rmq'): AppLogger {
    return new AppLogger(this.pinoLogger, source, channel);
  }
}
