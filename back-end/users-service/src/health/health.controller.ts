import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

@Controller()
export class HealthController {
  public constructor(private readonly health: HealthCheckService) {}

  @MessagePattern('health.check')
  public check(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
