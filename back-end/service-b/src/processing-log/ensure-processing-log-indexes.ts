import { type Collection, MongoServerError } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

const MILLISECONDS_PER_SECOND = 1000;
const INDEX_OPTIONS_CONFLICT_ERROR_CODE = 85;
const RETENTION_INDEX_KEY = { timestamp: 1 } as const;

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

export function toExpireAfterSeconds(retentionMs: number): number {
  return Math.max(1, Math.round(retentionMs / MILLISECONDS_PER_SECOND));
}

export async function ensureProcessingLogRetentionIndex(
  collection: Collection<IProcessingLogDocument>,
  retentionMs: number,
): Promise<void> {
  const expireAfterSeconds = toExpireAfterSeconds(retentionMs);

  try {
    await collection.createIndex(RETENTION_INDEX_KEY, { expireAfterSeconds });
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== INDEX_OPTIONS_CONFLICT_ERROR_CODE) {
      throw error;
    }

    await collection.db.command({
      collMod: collection.collectionName,
      index: { keyPattern: RETENTION_INDEX_KEY, expireAfterSeconds },
    });
  }
}
