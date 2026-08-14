import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type AmqpConnectionManager } from 'amqp-connection-manager';

import { RABBITMQ_CONNECTION_MANAGER } from '../rabbitmq-clients.tokens.js';

@Injectable()
export class RabbitMqConnectionHealthIndicator implements OnModuleDestroy {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(RABBITMQ_CONNECTION_MANAGER) private readonly connectionManager: AmqpConnectionManager,
  ) {}

  public isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);

    if (this.connectionManager.isConnected()) {
      return indicator.up();
    }

    return indicator.down({ message: 'not connected to the RabbitMQ broker' });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.connectionManager.close();
  }
}
