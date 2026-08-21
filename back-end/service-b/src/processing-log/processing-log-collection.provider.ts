import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/infra-clients.tokens.js';

import { type IProcessingLogDocument } from './processing-log.types.js';

export const PROCESSING_LOG_COLLECTION = 'PROCESSING_LOG_COLLECTION';

const PROCESSING_LOG_COLLECTION_NAME = 'processing-logs';

export function createProcessingLogCollection(
  client: MongoClient,
): Collection<IProcessingLogDocument> {
  return client.db().collection<IProcessingLogDocument>(PROCESSING_LOG_COLLECTION_NAME);
}

export const processingLogCollectionProvider = {
  provide: PROCESSING_LOG_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createProcessingLogCollection,
};
