import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

const MILLISECONDS_PER_SECOND = 1000;

export async function ensureProcessingLogIndexes(
  collection: Collection<IProcessingLogDocument>,
): Promise<void> {
  await Promise.all([
    collection.createIndex({ importId: 1, status: 1 }, { unique: true }),
    collection.createIndex({ importId: 1, timestamp: -1, _id: -1 }),
    collection.createIndex({ status: 1, timestamp: -1, _id: -1 }),
    collection.createIndex({ timestamp: -1, _id: -1 }),
  ]);
}

export async function ensureProcessingLogRetentionIndex(
  collection: Collection<IProcessingLogDocument>,
  retentionMs: number,
): Promise<void> {
  await collection.createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: Math.max(1, Math.round(retentionMs / MILLISECONDS_PER_SECOND)) },
  );
}
