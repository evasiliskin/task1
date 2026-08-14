import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { LoggerService } from '@task1/shared/logger/http/logger.service';
import * as amqp from 'amqp-connection-manager';
import { Redis } from 'ioredis';

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
      inject: [redisConfig.KEY, LoggerService],
      useFactory: createRedisClient,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class HealthModule {}
