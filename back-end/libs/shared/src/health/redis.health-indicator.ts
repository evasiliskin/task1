import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type Redis } from 'ioredis';
import { firstValueFrom, from, timeout } from 'rxjs';

import { REDIS_CLIENT } from '../infra/client-tokens.js';

@Injectable()
export class RedisHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly client: Redis,
  ) {}

  public async isHealthy(key: string, timeoutMs: number): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await firstValueFrom(from(this.client.ping()).pipe(timeout(timeoutMs)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
