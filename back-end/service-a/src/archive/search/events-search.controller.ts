import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ackMessage } from '../rmq-ack.util.js';

import { EventsSearchService } from './events-search.service.js';
import { searchEventsMessageSchema } from './search-events-message.schema.js';
import { type IPaginationResult } from './search-events.js';

@Controller()
export class EventsSearchController {
  public constructor(private readonly eventsSearchService: EventsSearchService) {}

  @MessagePattern(RPC_PATTERNS.EVENTS_SEARCH)
  public async handleSearch(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IPaginationResult<IGithubEventDocument>> {
    try {
      const message = searchEventsMessageSchema.parse(payload);

      return await this.eventsSearchService.search(message);
    } finally {
      ackMessage(context);
    }
  }
}
