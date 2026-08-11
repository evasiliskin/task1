import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';

import rabbitmqConfig from '../config/rabbitmq.config';

import { HealthController } from './health.controller';
import { PRODUCTS_SERVICE_RMQ_CLIENT, USERS_SERVICE_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Module({
  imports: [
    TerminusModule,
    ClientsModule.registerAsync([
      {
        name: USERS_SERVICE_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.usersQueue,
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: PRODUCTS_SERVICE_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.productsQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [HealthController],
  providers: [RabbitMqPingHealthIndicator],
})
export class HealthModule {}
