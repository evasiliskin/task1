import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Filter } from 'mongodb';

import { type IEventCursor } from './event-cursor.util.js';
import { type SearchEventsMessage } from './search-events-message.schema.js';

export function buildEventsFilter(
  message: SearchEventsMessage,
  cursor?: IEventCursor,
): Filter<IGithubEventDocument> {
  const filter: Filter<IGithubEventDocument> = {};

  if (message.type !== undefined) {
    filter.eventType = message.type;
  }

  if (message.repository !== undefined) {
    filter['repo.name'] = message.repository;
  }

  if (message.actor !== undefined) {
    filter['actor.login'] = message.actor;
  }

  if (message.from !== undefined || message.to !== undefined) {
    filter.createdAt = {
      ...(message.from === undefined ? {} : { $gte: new Date(message.from) }),
      ...(message.to === undefined ? {} : { $lte: new Date(message.to) }),
    };
  }

  if (cursor === undefined) {
    return filter;
  }

  return {
    $and: [
      filter,
      {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, eventId: { $lt: cursor.eventId } },
        ],
      },
    ],
  };
}
