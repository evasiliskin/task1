import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { RedisHealthIndicator } from '@task1/shared/health/redis.health-indicator';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { type ILoggerFactory } from '@task1/shared/logger/logger-factory.interface';
import { LOGGER_FACTORY } from '@task1/shared/logger/logger.tokens';
import { createRedisClient } from '@task1/shared/redis/create-redis-client';
import { RedisConnectionService } from '@task1/shared/redis/redis-connection.service';

import redisConfig from '../config/redis.config.js';

import { HealthCheckService } from './health-check.service.js';
import { HealthController } from './health.controller.js';
import { GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { REDIS_CLIENT } from './infra-clients.tokens.js';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

@Module({
  imports: [TerminusModule, LoggerModule],
  controllers: [HealthController],
  providers: [
    RedisConnectionService,
    HealthCheckService,
    RabbitMqPingHealthIndicator,
    GatewayHealthIndicator,
    RedisHealthIndicator,
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY, LOGGER_FACTORY],
      useFactory: (config: ConfigType<typeof redisConfig>, loggerFactory: ILoggerFactory) =>
        createRedisClient(config.url, loggerFactory),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class HealthModule {}
