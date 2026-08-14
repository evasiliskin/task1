import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, type RmqContext } from '@nestjs/microservices';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ackMessage } from '../archive/rmq-ack.util.js';

@Controller()
export class HealthController {
  public constructor(private readonly health: HealthCheckService) {}

  @MessagePattern(RPC_PATTERNS.HEALTH_CHECK)
  public async check(@Ctx() context: RmqContext): Promise<HealthCheckResult> {
    try {
      return await this.health.check([]);
    } finally {
      ackMessage(context);
    }
  }
}
