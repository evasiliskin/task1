import { Inject, Injectable } from '@nestjs/common';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { MetricsService } from '../../infra/redis/metrics.service.js';
import { EVENTS_COLLECTION } from '../events-collection.provider.js';

import { type SearchEventsMessage } from './search-events-message.schema.js';
import { searchEvents, type IPaginationResult } from './search-events.js';

const METRIC_SEARCH_REQUESTS = 'service_a.archive.search.requests';

@Injectable()
export class EventsSearchService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    private readonly metricsService: MetricsService,
  ) {}

  public async search(
    message: SearchEventsMessage,
  ): Promise<IPaginationResult<IGithubEventDocument>> {
    const result = await searchEvents(this.collection, message);

    await this.metricsService.recordMetric(METRIC_SEARCH_REQUESTS, 1);

    return result;
  }
}
