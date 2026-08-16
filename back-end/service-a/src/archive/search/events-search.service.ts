import { Inject, Injectable } from '@nestjs/common';
import { type IEventView, type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type ICursorPage } from '@task1/shared/pagination/cursor-page.types';
import { type Collection } from 'mongodb';

import { MetricsService } from '../../infra/redis/metrics.service.js';
import { EVENTS_COLLECTION } from '../events-collection.provider.js';

import { type SearchEventsMessage } from './search-events-message.schema.js';
import { searchEvents } from './search-events.js';

const METRIC_SEARCH_REQUESTS = 'service_a.archive.search.requests';

@Injectable()
export class EventsSearchService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    private readonly metricsService: MetricsService,
  ) {}

  public async search(message: SearchEventsMessage): Promise<ICursorPage<IEventView>> {
    const result = await searchEvents(this.collection, message);

    // eslint-disable-next-line no-void -- Not awaited: a Redis round trip does not belong on the latency path of a read, and `recordMetric` already handles and logs its own failures.
    void this.metricsService.recordMetric(METRIC_SEARCH_REQUESTS, 1);

    return result;
  }
}
