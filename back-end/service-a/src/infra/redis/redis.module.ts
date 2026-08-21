import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import redisConfig from '@task1/shared/config/redis.config';
import { type ILoggerFactory } from '@task1/shared/logger/logger-factory.interface';
import { LOGGER_FACTORY } from '@task1/shared/logger/logger.tokens';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { createRedisClient } from '@task1/shared/redis/create-redis-client';
import { RedisConnectionService } from '@task1/shared/redis/redis-connection.service';

import { REDIS_CLIENT } from '../infra-clients.tokens.js';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [
    RedisConnectionService,
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY, LOGGER_FACTORY],
      useFactory: (config: ConfigType<typeof redisConfig>, loggerFactory: ILoggerFactory) =>
        createRedisClient(config.url, loggerFactory),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
