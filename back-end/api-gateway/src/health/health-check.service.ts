import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import {
  HealthCheckService as TerminusHealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';

import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator.js';
import { RedisHealthIndicator } from './indicators/redis.health-indicator.js';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

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
    private readonly rabbitMqConnectionIndicator: RabbitMqConnectionHealthIndicator,
    private readonly rabbitMqPingIndicator: RabbitMqPingHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(HealthCheckService.name);
  }

  public async getHealth(): Promise<IAggregatedHealth> {
    return await this.runAllChecks();
  }

  public getLiveness(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  public async getReadiness(): Promise<{ ready: boolean; result: IAggregatedHealth }> {
    const result = await this.runAllChecks();

    // Critical for readiness: rabbitmq, serviceA, serviceB — the gateway's
    // sole purpose is routing through them. redis is informational
    // (nothing in the gateway's request path uses it today).
    const ready =
      result.services.rabbitmq === 'ok' &&
      result.services.serviceA === 'ok' &&
      result.services.serviceB === 'ok';

    return { ready, result };
  }

  private readonly logger: AppLogger;

  private async runAllChecks(): Promise<IAggregatedHealth> {
    const startedAt = Date.now();
    const raw = await this.executeIndicators();
    const responseTimeMs = Date.now() - startedAt;

    this.logFailures(raw.details, responseTimeMs);

    const services: IAggregatedHealth['services'] = {
      gateway: raw.details.gateway?.status === 'up' ? 'ok' : 'unavailable',
      rabbitmq: raw.details.rabbitmq?.status === 'up' ? 'ok' : 'unavailable',
      serviceA: raw.details.serviceA?.status === 'up' ? 'ok' : 'unavailable',
      serviceB: raw.details.serviceB?.status === 'up' ? 'ok' : 'unavailable',
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
        () => this.rabbitMqConnectionIndicator.isHealthy('rabbitmq'),
        () => this.rabbitMqPingIndicator.isHealthy('serviceA', this.serviceAClient),
        () => this.rabbitMqPingIndicator.isHealthy('serviceB', this.serviceBClient),
        () => this.redisIndicator.isHealthy('redis'),
      ]);
    } catch (error) {
      // Terminus's own check() throws ServiceUnavailableException as soon as
      // any indicator is down; its response body still holds every
      // indicator's result (up and down alike), so we recover it here
      // instead of letting the throw propagate — /health and /health/ready
      // decide what to do with a down dependency themselves.
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }

      throw error;
    }
  }

  private logFailures(details: HealthCheckResult['details'], responseTimeMs: number): void {
    // correlationId and requestId are stamped on every line by pino's mixin — repeating them here
    // would model a pattern that hides the fact that context is automatic.
    Object.entries(details).forEach(([service, detail]) => {
      if (detail.status === 'down') {
        this.logger.error(
          { service, errorMessage: detail.message, responseTimeMs },
          `health check failed for ${service}`,
        );
      }
    });
  }
}
