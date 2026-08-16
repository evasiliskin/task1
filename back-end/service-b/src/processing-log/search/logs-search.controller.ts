import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { LogsSearchService } from './logs-search.service.js';
import { searchLogsMessageSchema } from './search-logs-message.schema.js';
import { type SearchLogsResult } from './search-logs.js';

@Controller()
export class LogsSearchController {
  public constructor(private readonly logsSearchService: LogsSearchService) {}

  @MessagePattern(RPC_PATTERNS.LOGS_SEARCH)
  public async handleSearch(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<SearchLogsResult> {
    try {
      const message = searchLogsMessageSchema.parse(payload);

      return await this.logsSearchService.search(message);
    } finally {
      ackMessage(context);
    }
  }
}
