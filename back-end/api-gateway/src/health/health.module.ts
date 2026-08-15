import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { type ILoggerFactory } from '@task1/shared/logger/logger-factory.interface';
import { LOGGER_FACTORY } from '@task1/shared/logger/logger.tokens';
import { createRedisClient } from '@task1/shared/redis/create-redis-client';
import * as amqp from 'amqp-connection-manager';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import redisConfig from '../config/redis.config.js';
import { RABBITMQ_CONNECTION_MANAGER } from '../rmq/rmq-client.tokens.js';

import { HealthCheckService } from './health-check.service.js';
import { HealthController } from './health.controller.js';
import { GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator.js';
import { RedisHealthIndicator } from './indicators/redis.health-indicator.js';
import { REDIS_CLIENT } from './infra-clients.tokens.js';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

@Module({
  imports: [TerminusModule, LoggerModule],
  controllers: [HealthController],
  providers: [
    HealthCheckService,
    RabbitMqPingHealthIndicator,
    GatewayHealthIndicator,
    RabbitMqConnectionHealthIndicator,
    RedisHealthIndicator,
    {
      provide: RABBITMQ_CONNECTION_MANAGER,
      inject: [rabbitmqConfig.KEY],
      useFactory: (config: ConfigType<typeof rabbitmqConfig>) => amqp.connect([config.url]),
    },
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
