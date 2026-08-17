import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

@Injectable()
export class RabbitMqPingHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly propagatingClient: ContextPropagatingClient,
    @Inject(rabbitmqConfig.KEY) private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  public async isHealthy(key: string, client: ClientProxy): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const request$ = this.propagatingClient.send(client, RPC_PATTERNS.HEALTH_CHECK, {});

    try {
      await firstValueFrom(request$.pipe(timeout(this.config.pingTimeoutMs)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
