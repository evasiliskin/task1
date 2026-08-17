import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import {
  HealthCheckService as TerminusHealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from '@task1/shared/health/redis.health-indicator';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';

import redisConfig from '../config/redis.config.js';
import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { HealthTransitionLogger } from './health-transition-logger.js';
import { GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

export { HEALTH_CHECK_FAILED_LOG, HEALTH_CHECK_RECOVERED_LOG } from './health-transition-logger.js';

export type ServiceStatus = 'ok' | 'unavailable';

export interface IAggregatedHealth {
  status: 'ok' | 'degraded';
  services: {
    gateway: ServiceStatus;
    rabbitmq: ServiceStatus;
    serviceA: ServiceStatus;
    serviceB: ServiceStatus;
    redis: ServiceStatus;
  };
}

@Injectable()
export class HealthCheckService {
  public constructor(
    private readonly terminus: TerminusHealthCheckService,
    private readonly gatewayIndicator: GatewayHealthIndicator,
    private readonly rabbitMqPingIndicator: RabbitMqPingHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    @Inject(redisConfig.KEY) private readonly redisConfiguration: ConfigType<typeof redisConfig>,
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(HealthCheckService.name);
    this.transitionLogger = new HealthTransitionLogger(this.logger);
  }

  public async getHealth(): Promise<IAggregatedHealth> {
    return await this.runAllChecks();
  }

  public getLiveness(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  public async getReadiness(): Promise<{ ready: boolean; result: IAggregatedHealth }> {
    const result = await this.runAllChecks();

    const ready = Object.values(result.services).every((status) => status === 'ok');

    return { ready, result };
  }

  public hasCheckInFlight(): boolean {
    return this.inFlightCheck !== undefined;
  }

  private readonly logger: AppLogger;

  private readonly transitionLogger: HealthTransitionLogger;

  private inFlightCheck?: Promise<IAggregatedHealth>;

  private async runAllChecks(): Promise<IAggregatedHealth> {
    this.inFlightCheck ??= this.executeAllChecks().finally(() => {
      this.inFlightCheck = undefined;
    });

    return await this.inFlightCheck;
  }

  private async executeAllChecks(): Promise<IAggregatedHealth> {
    const startedAt = Date.now();
    const raw = await this.executeIndicators();
    const responseTimeMs = Date.now() - startedAt;

    this.transitionLogger.record(raw.details, responseTimeMs);

    const serviceA: ServiceStatus = raw.details.serviceA?.status === 'up' ? 'ok' : 'unavailable';
    const serviceB: ServiceStatus = raw.details.serviceB?.status === 'up' ? 'ok' : 'unavailable';

    const services: IAggregatedHealth['services'] = {
      gateway: raw.details.gateway?.status === 'up' ? 'ok' : 'unavailable',
      rabbitmq: serviceA === 'ok' || serviceB === 'ok' ? 'ok' : 'unavailable',
      serviceA,
      serviceB,
      redis: raw.details.redis?.status === 'up' ? 'ok' : 'unavailable',
    };

    const status: IAggregatedHealth['status'] = Object.values(services).every(
      (value) => value === 'ok',
    )
      ? 'ok'
      : 'degraded';

    return { status, services };
  }

  private async executeIndicators(): Promise<HealthCheckResult> {
    try {
      return await this.terminus.check([
        () => this.gatewayIndicator.isHealthy('gateway'),
        () => this.rabbitMqPingIndicator.isHealthy('serviceA', this.serviceAClient),
        () => this.rabbitMqPingIndicator.isHealthy('serviceB', this.serviceBClient),
        () => this.redisIndicator.isHealthy('redis', this.redisConfiguration.pingTimeoutMs),
      ]);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }

      throw error;
    }
  }
}
