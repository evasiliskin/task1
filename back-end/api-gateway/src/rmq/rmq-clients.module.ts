import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import {
  SERVICE_A_IMPORTS_RMQ_CLIENT,
  SERVICE_A_RMQ_CLIENT,
  SERVICE_B_RMQ_CLIENT,
} from './rmq-client.tokens.js';

@Global()
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
            queueOptions: { durable: true, noAssert: true },
          },
        }),
      },
      {
        name: SERVICE_A_IMPORTS_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceAImportsQueue,
            queueOptions: { durable: true, noAssert: true },
          },
        }),
      },
      {
        name: SERVICE_B_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceBQueue,
            queueOptions: { durable: true, noAssert: true },
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class RmqClientsModule {}
