import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { EventsController } from './events.controller.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

@Module({
  imports: [
    ClientsModule.registerAsync([
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
  controllers: [EventsController],
})
export class EventsModule {}
