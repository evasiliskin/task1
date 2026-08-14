import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { buildEventsFilter } from './build-events-filter.js';
import { decodeEventCursor, encodeEventCursor } from './event-cursor.util.js';
import { type SearchEventsMessage } from './search-events-message.schema.js';

const EVENT_PROJECTION = { _id: 0 } as const;

export interface IPaginationResult<T> {
  data: T[];
  nextCursor?: string;
}

export async function searchEvents(
  collection: Collection<IGithubEventDocument>,
  message: SearchEventsMessage,
): Promise<IPaginationResult<IGithubEventDocument>> {
  const cursor = message.cursor === undefined ? undefined : decodeEventCursor(message.cursor);
  const filter = buildEventsFilter(message, cursor);

  const documents = await collection
    .find(filter, { projection: EVENT_PROJECTION })
    .sort({ createdAt: -1, eventId: -1 })
    .limit(message.limit + 1)
    .toArray();

  const hasNextPage = documents.length > message.limit;
  const data = hasNextPage ? documents.slice(0, message.limit) : documents;
  const lastEvent = data.at(-1);

  if (!hasNextPage || lastEvent === undefined) {
    return { data };
  }

  return {
    data,
    nextCursor: encodeEventCursor({ createdAt: lastEvent.createdAt, eventId: lastEvent.eventId }),
  };
}
