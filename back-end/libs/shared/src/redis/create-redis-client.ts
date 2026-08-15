import { Redis } from 'ioredis';

import { type ILoggerFactory } from '../logger/logger-factory.interface.js';

const REDIS_ERROR_LOG = 'Redis client error';
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

  // ioredis reconnect storms emit 'error' continuously. One line per interval, carrying how many
  // were suppressed, keeps the outage visible without flooding the log pipeline.
  let lastLoggedAt = 0;
  let suppressedCount = 0;

  client.on('error', (error: Error) => {
    const now = Date.now();

    if (now - lastLoggedAt < REDIS_ERROR_LOG_INTERVAL_MS) {
      suppressedCount += 1;

      return;
    }

    logger.warn({ suppressedCount }, REDIS_ERROR_LOG, error);
    lastLoggedAt = now;
    suppressedCount = 0;
  });

  return client;
}
