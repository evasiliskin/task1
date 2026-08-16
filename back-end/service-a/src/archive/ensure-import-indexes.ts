import { type Collection } from 'mongodb';

import { type IImportRunDocument } from './import-run.types.js';

/**
 * The index definitions are independent, so they are created concurrently rather than in eleven
 * serialised round trips across the three ensure functions. Safe parallelism: no shared state, and
 * MongoDB builds indexes on distinct keys concurrently.
 */
export async function ensureImportIndexes(
  collection: Collection<IImportRunDocument>,
): Promise<void> {
  await Promise.all([
    collection.createIndex({ importId: 1 }, { unique: true }),
    // Serves the startup reconciliation sweep for runs abandoned in `started`.
    collection.createIndex({ status: 1, startedAt: 1 }),
  ]);
}
