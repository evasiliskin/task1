import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

export async function ensureProcessingLogIndexes(
  collection: Collection<IProcessingLogDocument>,
): Promise<void> {
  await collection.createIndex({ importId: 1, status: 1 }, { unique: true });
  await collection.createIndex({ importId: 1, timestamp: -1 });
  await collection.createIndex({ status: 1, timestamp: -1 });
  await collection.createIndex({ timestamp: -1, _id: -1 });
}
