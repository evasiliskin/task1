import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RedisConnectionService } from '@task1/shared/redis/redis-connection.service';
import { Redis } from 'ioredis';

import redisConfig from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

const REDIS_ERROR_LOG = 'Redis client error';

export function createRedisClient(
  config: ConfigType<typeof redisConfig>,
  loggerService: LoggerService,
): Redis {
  const client = new Redis(config.url, { lazyConnect: true });
  const logger = loggerService.getLogger('RedisClient');

  // A listener is mandatory: ioredis emits 'error' on a lazily-connected client
  // before connect() settles, and an unhandled EventEmitter 'error' terminates
  // the process. Logging here keeps that protection while making mid-life Redis
  // outages visible, which a no-op listener hides for the client's whole lifetime.
  client.on('error', (error: Error) => {
    logger.warn({}, REDIS_ERROR_LOG, error);
  });

  return client;
}

@Global()
@Module({
  imports: [LoggerModule],
  providers: [
    RedisConnectionService,
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY, LoggerService],
      useFactory: createRedisClient,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
