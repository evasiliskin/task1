import { Inject, Injectable } from '@nestjs/common';
import { type IEventView, type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type ICursorPage } from '@task1/shared/pagination/cursor-page.types';
import { type Collection } from 'mongodb';

import { EVENTS_COLLECTION } from '../events-collection.provider.js';

import { type SearchEventsMessage } from './search-events-message.schema.js';
import { searchEvents } from './search-events.js';

@Injectable()
export class EventsSearchService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
  ) {}

  public search(message: SearchEventsMessage): Promise<ICursorPage<IEventView>> {
    return searchEvents(this.collection, message);
  }
}
