import { type IEventView, type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type ICursorPage } from '@task1/shared/pagination/cursor-page.types';
import { type Collection } from 'mongodb';

import { buildEventsFilter } from './build-events-filter.js';
import { decodeEventCursor, encodeEventCursor } from './event-cursor.util.js';
import { type SearchEventsMessage } from './search-events-message.schema.js';
import { toEventView } from './to-event-view.js';

const EVENT_PROJECTION = { _id: 0 } as const;

export async function searchEvents(
  collection: Collection<IGithubEventDocument>,
  message: SearchEventsMessage,
): Promise<ICursorPage<IEventView>> {
  const cursor = message.cursor === undefined ? undefined : decodeEventCursor(message.cursor);
  const filter = buildEventsFilter(message, cursor);

  const documents = await collection
    .find(filter, { projection: EVENT_PROJECTION })
    .sort({ createdAt: -1, eventId: -1 })
    .limit(message.limit + 1)
    .toArray();

  const hasNextPage = documents.length > message.limit;
  const documentsPage = hasNextPage ? documents.slice(0, message.limit) : documents;
  const data = documentsPage.map(toEventView);
  const lastDocument = documentsPage.at(-1);

  if (!hasNextPage || lastDocument === undefined) {
    return { data };
  }

  return {
    data,
    nextCursor: encodeEventCursor({
      createdAt: lastDocument.createdAt,
      eventId: lastDocument.eventId,
    }),
  };
}
