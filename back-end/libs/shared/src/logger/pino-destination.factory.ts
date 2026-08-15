import { destination, type DestinationStream } from 'pino';

import { type ILoggerConfiguration } from '../config/logger.config.js';

const BUFFER_MIN_LENGTH_BYTES = 4096;
/**
 * Upper bound on how long a log line can sit unflushed in the sonic-boom buffer under normal
 * (non-crash) traffic. `minLength` alone has no time bound — a quiet period well under 4 KB would
 * otherwise buffer indefinitely until shutdown. sonic-boom's own `periodicFlush` runs an
 * `.unref()`d `setInterval` internally (cleared automatically on `end`/`destroy`), so this reuses
 * the buffered destination's own async, non-blocking `flush()` rather than a hand-rolled timer.
 */
const PERIODIC_FLUSH_INTERVAL_MS = 3000;

export interface IFlushableDestination extends DestinationStream {
  flushSync(): void;
}

/**
 * Buffered, non-blocking stdout. Pino's synchronous default writes straight to fd 1; in a
 * container that is a pipe, so a stalled log collector blocks the event loop and logging becomes
 * a liveness dependency. Buffered lines are flushed on shutdown by `LoggerFlushService`, and at
 * most every periodic-flush interval in between so logs stay visible under normal traffic.
 *
 * Returns `undefined` for the `pretty` transport: `pino-pretty` runs in a worker thread and owns
 * the output stream itself, so a destination must not also be supplied.
 */
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
