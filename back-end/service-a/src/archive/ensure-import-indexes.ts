import { type Collection } from 'mongodb';

import { type IImportRunDocument } from './import-run.types.js';

export async function ensureImportIndexes(
  collection: Collection<IImportRunDocument>,
): Promise<void> {
  await Promise.all([
    collection.createIndex({ importId: 1 }, { unique: true }),
    collection.createIndex({ status: 1, startedAt: 1 }),
    collection.createIndex(
      { idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
    ),
    collection.createIndex(
      { claimedAt: 1 },
      { partialFilterExpression: { claimedAt: { $exists: true } } },
    ),
  ]);
}
