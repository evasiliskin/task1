import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { ReportsController } from './reports.controller.js';

@Module({
  imports: [
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
    ]),
  ],
  controllers: [ReportsController],
})
export class ReportsModule {}
