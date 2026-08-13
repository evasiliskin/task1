import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';

import { EventsSearchService } from './events-search.service.js';
import { searchEventsMessageSchema } from './search-events-message.schema.js';
import { type IPaginationResult } from './search-events.js';

@Controller()
export class EventsSearchController {
  public constructor(private readonly eventsSearchService: EventsSearchService) {}

  @MessagePattern('events.search')
  public async handleSearch(
    @Payload() payload: unknown,
  ): Promise<IPaginationResult<IGithubEventDocument>> {
    const message = searchEventsMessageSchema.parse(payload);

    return await this.eventsSearchService.search(message);
  }
}
