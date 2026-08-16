import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type MongoClient } from 'mongodb';
import { firstValueFrom, from, timeout } from 'rxjs';

import { MONGO_CLIENT } from '../infra/client-tokens.js';

/**
 * Reports whether this process can actually reach its MongoDB.
 *
 * `timeoutMs` is a parameter rather than injected config: the same indicator serves service-a and
 * service-b, and shared infrastructure should not depend on either one's configuration shape. This
 * mirrors the gateway's RabbitMQ ping indicator, which takes its client the same way.
 */
@Injectable()
export class MongoHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
  ) {}

  public async isHealthy(key: string, timeoutMs: number): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await firstValueFrom(from(this.client.db().command({ ping: 1 })).pipe(timeout(timeoutMs)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
