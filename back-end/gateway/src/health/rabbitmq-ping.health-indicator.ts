import { Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { firstValueFrom, timeout } from 'rxjs';

const PING_TIMEOUT_MS = 3000;

@Injectable()
export class RabbitMqPingHealthIndicator {
  public constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  public async isHealthy(key: string, client: ClientProxy): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await firstValueFrom(client.send('health.check', {}).pipe(timeout(PING_TIMEOUT_MS)));

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unknown error' });
    }
  }
}
