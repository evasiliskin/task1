import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';

import { type RedisConfiguration } from '../../config/redis.config.js';

import { createRedisClient } from './redis.module.js';

describe('createRedisClient', () => {
  const config: RedisConfiguration = {
    url: 'redis://localhost:6379',
    metricsRetentionMs: 604_800_000,
  };

  it('should log rather than swallow errors emitted by the Redis client', () => {
    const warn = vi.fn();
    const getLogger = vi.fn().mockReturnValue({ warn });
    const loggerService = { getLogger } as unknown as LoggerService;

    const client = createRedisClient(config, loggerService);

    client.emit('error', new Error('ECONNRESET'));

    expect(warn).toHaveBeenCalledWith({}, 'Redis client error', expect.any(Error));
  });
});
