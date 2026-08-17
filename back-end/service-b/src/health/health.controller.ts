import { Controller, Inject } from '@nestjs/common';
import { Ctx, MessagePattern, type RmqContext } from '@nestjs/microservices';
import { type HealthCheckResult } from '@nestjs/terminus';
import healthConfig, { type HealthConfiguration } from '@task1/shared/config/health.config';
import { DependencyHealthService } from '@task1/shared/health/dependency-health.service';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

@Controller()
export class HealthController {
  public constructor(
    private readonly dependencyHealth: DependencyHealthService,
    @Inject(healthConfig.KEY) private readonly healthConfiguration: HealthConfiguration,
  ) {}

  @MessagePattern(RPC_PATTERNS.HEALTH_CHECK)
  public async check(@Ctx() context: RmqContext): Promise<HealthCheckResult> {
    try {
      return await this.dependencyHealth.check(this.healthConfiguration.pingTimeoutMs);
    } finally {
      ackMessage(context);
    }
  }
}
