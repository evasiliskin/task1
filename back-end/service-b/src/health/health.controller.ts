import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, type RmqContext } from '@nestjs/microservices';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

@Controller()
export class HealthController {
  public constructor(private readonly health: HealthCheckService) {}

  @MessagePattern(RPC_PATTERNS.HEALTH_CHECK)
  public async check(@Ctx() context: RmqContext): Promise<HealthCheckResult> {
    const result = await this.health.check([]);

    ackMessage(context);

    return result;
  }
}
