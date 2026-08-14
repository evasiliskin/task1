import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- RmqContext channel is loosely typed; matches HealthController's manual-ack precedent under noAck: false
      context.getChannelRef().ack(context.getMessage());
    }
  }
}
