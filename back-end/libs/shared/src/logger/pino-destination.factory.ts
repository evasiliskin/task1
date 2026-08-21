import { destination, type DestinationStream } from 'pino';

import { type ILoggerConfiguration } from '../config/logger.config.js';

const BUFFER_MIN_LENGTH_BYTES = 4096;
const PERIODIC_FLUSH_INTERVAL_MS = 3000;

export interface IFlushableDestination extends DestinationStream {
  flushSync(): void;
}

export function createPinoDestination(
  config: ILoggerConfiguration,
): IFlushableDestination | undefined {
  if (config.transport === 'pretty') {
    return undefined;
  }

  return destination({
    minLength: BUFFER_MIN_LENGTH_BYTES,
    sync: false,
    periodicFlush: PERIODIC_FLUSH_INTERVAL_MS,
  });
}
