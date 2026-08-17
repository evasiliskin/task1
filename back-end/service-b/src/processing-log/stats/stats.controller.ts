import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { getStatsMessageSchema } from './get-stats-message.schema.js';
import { type IStatsResult } from './get-stats.js';
import { StatsService } from './stats.service.js';

@Controller()
export class StatsController {
  public constructor(private readonly statsService: StatsService) {}

  @MessagePattern(RPC_PATTERNS.STATS_GET)
  public async handleGetStats(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IStatsResult> {
    try {
      const message = getStatsMessageSchema.parse(payload);

      return await this.statsService.getStats(message.importId);
    } finally {
      ackMessage(context);
    }
  }
}
