import { type AppLogger } from './app-logger.js';
import { type LogChannel } from './types.js';

export interface ILoggerFactory {
  getLogger(source: string, channel?: LogChannel): AppLogger;
}

export abstract class LoggerAware {
  protected readonly logger: AppLogger;

  protected constructor(loggerFactory: ILoggerFactory) {
    this.logger = loggerFactory.getLogger(this.constructor.name);
  }
}
