import { type Collection } from 'mongodb';

import { type IImportRunDocument } from './import-run.types.js';

export async function ensureImportIndexes(
  collection: Collection<IImportRunDocument>,
): Promise<void> {
  await collection.createIndex({ importId: 1 }, { unique: true });
  // Serves the startup reconciliation sweep for runs abandoned in `started`.
  await collection.createIndex({ status: 1, startedAt: 1 });
}
