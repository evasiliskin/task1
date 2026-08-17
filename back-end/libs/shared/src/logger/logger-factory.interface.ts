import { type AppLogger } from './app-logger.js';
import { type LogChannel } from './types.js';

export interface ILoggerFactory {
  getLogger(source: string, channel?: LogChannel): AppLogger;
}
