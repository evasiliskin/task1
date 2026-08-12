import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, MessagePattern } from '@nestjs/microservices';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Controller()
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly rabbitMqPing: RabbitMqPingHealthIndicator,
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
  ) {}

  @MessagePattern('health.check')
  public check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.rabbitMqPing.isHealthy('service-b', this.serviceBClient)]);
  }
}
