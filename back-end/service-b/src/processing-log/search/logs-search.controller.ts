import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';

import { LogsSearchService } from './logs-search.service.js';
import { searchLogsMessageSchema } from './search-logs-message.schema.js';
import { type SearchLogsResult } from './search-logs.js';

@Controller()
export class LogsSearchController {
  public constructor(private readonly logsSearchService: LogsSearchService) {}

  @MessagePattern('logs.search')
  public async handleSearch(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<SearchLogsResult> {
    try {
      const message = searchLogsMessageSchema.parse(payload);

      return await this.logsSearchService.search(message);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- RmqContext channel is loosely typed; matches HealthController's manual-ack precedent under noAck: false
      context.getChannelRef().ack(context.getMessage());
    }
  }
}
