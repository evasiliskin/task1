import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckService as TerminusHealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';

import { MongoHealthIndicator } from './mongo.health-indicator.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

/**
 * Runs a service's own infrastructure checks.
 *
 * Exists so the RMQ health controllers stay transport-only: they parse, delegate and ack. The list
 * of what "healthy" means for a service lives here, in one place, for both service-a and service-b.
 */
@Injectable()
export class DependencyHealthService {
  public constructor(
    private readonly terminus: TerminusHealthCheckService,
    private readonly mongoIndicator: MongoHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  public async check(timeoutMs: number): Promise<HealthCheckResult> {
    try {
      return await this.terminus.check([
        () => this.mongoIndicator.isHealthy('mongodb', timeoutMs),
        () => this.redisIndicator.isHealthy('redis', timeoutMs),
      ]);
    } catch (error) {
      // Terminus throws as soon as any indicator is down, but its response body still carries every
      // indicator's result. The caller decides what a down dependency means, so the body is
      // recovered rather than letting the throw escape — the same treatment the gateway's
      // HealthCheckService already applies.
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }

      throw error;
    }
  }
}
