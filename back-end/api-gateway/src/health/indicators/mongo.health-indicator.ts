import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { type MongoClient } from 'mongodb';
import { firstValueFrom, from, timeout } from 'rxjs';

import mongodbConfig from '../../config/mongodb.config';
import { MONGO_CLIENT } from '../infra-clients.tokens';

@Injectable()
export class MongoHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(mongodbConfig.KEY) private readonly config: ConfigType<typeof mongodbConfig>,
  ) {}

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await firstValueFrom(
        from(this.client.db().command({ ping: 1 })).pipe(timeout(this.config.pingTimeoutMs)),
      );

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
