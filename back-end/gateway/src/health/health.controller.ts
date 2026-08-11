import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Controller('health')
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly rabbitMqPing: RabbitMqPingHealthIndicator,
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
  ) {}

  @Get('service-b')
  @HealthCheck()
  public checkServiceB(): Promise<HealthCheckResult> {
    return this.health.check([() => this.rabbitMqPing.isHealthy('service-b', this.serviceBClient)]);
  }

  @Get('service-a')
  @HealthCheck()
  public checkServiceA(): Promise<HealthCheckResult> {
    return this.health.check([() => this.rabbitMqPing.isHealthy('service-a', this.serviceAClient)]);
  }
}
