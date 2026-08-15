import { Redis } from 'ioredis';

import { LogThrottle } from '../logger/log-throttle.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';

const REDIS_ERROR_LOG = 'Redis client error';
const REDIS_ERROR_THROTTLE_KEY = 'redis-client-error';
export const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * A listener is mandatory: ioredis emits 'error' on a lazily-connected client before connect()
 * settles, and an unhandled EventEmitter 'error' terminates the process. Logging here keeps that
 * protection while making mid-life Redis outages visible, which a no-op listener hides for the
 * client's whole lifetime.
 */
export function createRedisClient(url: string, loggerFactory: ILoggerFactory): Redis {
  const client = new Redis(url, { lazyConnect: true });
  const logger = loggerFactory.getLogger('RedisClient');
  // Per-client, not shared: two clients failing independently each deserve their own line.
  const throttle = new LogThrottle();

  // ioredis reconnect storms emit 'error' continuously. One line per interval, carrying how many
  // were suppressed, keeps the outage visible without flooding the log pipeline.
  client.on('error', (error: Error) => {
    if (!throttle.shouldLog(REDIS_ERROR_THROTTLE_KEY, REDIS_ERROR_LOG_INTERVAL_MS)) {
      return;
    }

    logger.warn(
      { suppressedCount: throttle.takeSuppressedCount(REDIS_ERROR_THROTTLE_KEY) },
      REDIS_ERROR_LOG,
      error,
    );
  });

  return client;
}
