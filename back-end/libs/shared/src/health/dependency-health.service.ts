import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckService as TerminusHealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';

import { MongoHealthIndicator } from './mongo.health-indicator.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

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
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }

      throw error;
    }
  }
}
