import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../../infra/infra-clients.tokens.js';

import { type IStatsRollupDocument } from './stats-rollup.types.js';

export const STATS_ROLLUP_COLLECTION = 'STATS_ROLLUP_COLLECTION';

const STATS_ROLLUP_COLLECTION_NAME = 'stats-rollups';

export function createStatsRollupCollection(client: MongoClient): Collection<IStatsRollupDocument> {
  return client.db().collection<IStatsRollupDocument>(STATS_ROLLUP_COLLECTION_NAME);
}

export const statsRollupCollectionProvider = {
  provide: STATS_ROLLUP_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createStatsRollupCollection,
};
