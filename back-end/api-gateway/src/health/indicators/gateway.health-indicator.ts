import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class GatewayHealthIndicator {
  public constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  public isHealthy(key: string): HealthIndicatorResult {
    return this.healthIndicatorService.check(key).up();
  }
}
