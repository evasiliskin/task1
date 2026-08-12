import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppLogger } from '../app-logger';
import { type LogChannel } from '../types';

@Injectable()
export class LoggerService {
  public constructor(private readonly pinoLogger: PinoLogger) {}

  public getLogger(source: string, channel: LogChannel = 'http'): AppLogger {
    return new AppLogger(this.pinoLogger, source, channel);
  }
}
