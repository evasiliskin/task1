import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config';
import { buildOutboundHeaders } from '../core/request-context/propagation.util';
import { RequestContextService } from '../core/request-context/request-context.service';

@Injectable()
export class RabbitMqPingHealthIndicator {
  public constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY) private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  public async isHealthy(key: string, client: ClientProxy): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder({}).setOptions({ headers }).build();

    try {
      await firstValueFrom(
        client.send('health.check', record).pipe(timeout(this.config.pingTimeoutMs)),
      );

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
