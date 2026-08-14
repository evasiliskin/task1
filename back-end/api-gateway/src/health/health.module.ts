import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import * as amqp from 'amqp-connection-manager';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';

import mongodbConfig from '../config/mongodb.config.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import redisConfig from '../config/redis.config.js';

import { HealthCheckService } from './health-check.service.js';
import { HealthController } from './health.controller.js';
import { GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { MongoHealthIndicator } from './indicators/mongo.health-indicator.js';
import { RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator.js';
import { RedisHealthIndicator } from './indicators/redis.health-indicator.js';
import { MONGO_CLIENT, REDIS_CLIENT } from './infra-clients.tokens.js';
import {
  RABBITMQ_CONNECTION_MANAGER,
  SERVICE_A_RMQ_CLIENT,
  SERVICE_B_RMQ_CLIENT,
} from './rabbitmq-clients.tokens.js';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

@Module({
  imports: [
    TerminusModule,
    LoggerModule,
    ClientsModule.registerAsync([
      {
        name: SERVICE_B_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceBQueue,
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: SERVICE_A_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceAQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [HealthController],
  providers: [
    HealthCheckService,
    RabbitMqPingHealthIndicator,
    GatewayHealthIndicator,
    RabbitMqConnectionHealthIndicator,
    MongoHealthIndicator,
    RedisHealthIndicator,
    {
      provide: RABBITMQ_CONNECTION_MANAGER,
      inject: [rabbitmqConfig.KEY],
      useFactory: (config: ConfigType<typeof rabbitmqConfig>) => amqp.connect([config.url]),
    },
    {
      provide: MONGO_CLIENT,
      inject: [mongodbConfig.KEY],
      useFactory: (config: ConfigType<typeof mongodbConfig>) => new MongoClient(config.uri),
    },
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => {
        const client = new Redis(config.url, { lazyConnect: true });

        // ioredis emits 'error' on the lazily-connected client before the
        // first health check ever runs; without a listener, that would
        // crash the process (unhandled EventEmitter 'error' event).
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- deliberately swallowed; see comment above.
        client.on('error', () => {});

        return client;
      },
    },
  ],
})
export class HealthModule {}
