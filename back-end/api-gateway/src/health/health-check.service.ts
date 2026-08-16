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

    // Every one of these sits on the request path. rabbitmq, serviceA and serviceB because routing
    // through them is the gateway's whole job; redis because the global ThrottlerGuard is backed by
    // ThrottlerStorageRedisService, so a Redis outage turns every request into a 500. Readiness
    // that stays green through that gives the orchestrator nothing to act on.
    const ready = Object.values(result.services).every((status) => status === 'ok');

    return { ready, result };
  }

  /** Exposed so a test can assert the in-flight slot was released rather than reaching inside. */
  public hasCheckInFlight(): boolean {
    return this.inFlightCheck !== undefined;
  }

  private readonly logger: AppLogger;

  private readonly transitionLogger: HealthTransitionLogger;

  private inFlightCheck?: Promise<IAggregatedHealth>;

  /**
   * Probes that overlap share one check.
   *
   * Deliberately not a cache: a probe arriving after the previous check settled runs a fresh one,
   * so no stale status is ever reported. This only removes the duplicated fan-out — four indicators
   * including two RMQ round trips — when probes pile up.
   */
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
      // Derived, not separately probed. Both pings travel over the ClientProxy connections the
      // request path actually uses, so one succeeding proves the broker is reachable *and* the
      // gateway's own client works — which a dedicated connection could not, since it stayed `up`
      // while those clients were broken.
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
}
