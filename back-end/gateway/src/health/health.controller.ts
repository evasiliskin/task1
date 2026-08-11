import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { PRODUCTS_SERVICE_RMQ_CLIENT, USERS_SERVICE_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Controller('health')
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly rabbitMqPing: RabbitMqPingHealthIndicator,
    @Inject(USERS_SERVICE_RMQ_CLIENT) private readonly usersServiceClient: ClientProxy,
    @Inject(PRODUCTS_SERVICE_RMQ_CLIENT) private readonly productsServiceClient: ClientProxy,
  ) {}

  @Get('users-service')
  @HealthCheck()
  public checkUsersService(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.rabbitMqPing.isHealthy('users-service', this.usersServiceClient),
    ]);
  }

  @Get('products-service')
  @HealthCheck()
  public checkProductsService(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.rabbitMqPing.isHealthy('products-service', this.productsServiceClient),
    ]);
  }
}
