import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

export async function ensureProcessingLogIndexes(
  collection: Collection<IProcessingLogDocument>,
): Promise<void> {
  await collection.createIndex({ importId: 1, status: 1 }, { unique: true });
}
