import { Redis } from 'ioredis';

import { LogThrottle } from '../logger/log-throttle.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';

const REDIS_ERROR_LOG = 'Redis client error';
const REDIS_ERROR_THROTTLE_KEY = 'redis-client-error';
export const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

export function createRedisClient(url: string, loggerFactory: ILoggerFactory): Redis {
  const client = new Redis(url, { lazyConnect: true });
  const logger = loggerFactory.getLogger('RedisClient');
  const throttle = new LogThrottle();

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
