import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { PRODUCTS_SERVICE_RMQ_CLIENT, USERS_SERVICE_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Module({
  imports: [
    TerminusModule,
    ClientsModule.registerAsync([
      {
        name: USERS_SERVICE_RMQ_CLIENT,
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
            queue: process.env.RABBITMQ_USERS_QUEUE ?? 'users_service_queue',
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: PRODUCTS_SERVICE_RMQ_CLIENT,
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
            queue: process.env.RABBITMQ_PRODUCTS_QUEUE ?? 'products_service_queue',
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
