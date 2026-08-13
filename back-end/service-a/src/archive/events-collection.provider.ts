import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/infra-clients.tokens.js';

export const EVENTS_COLLECTION = 'EVENTS_COLLECTION';

const EVENTS_COLLECTION_NAME = 'events';

export function createEventsCollection(client: MongoClient): Collection<IGithubEventDocument> {
  return client.db().collection<IGithubEventDocument>(EVENTS_COLLECTION_NAME);
}

export const eventsCollectionProvider = {
  provide: EVENTS_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createEventsCollection,
};
