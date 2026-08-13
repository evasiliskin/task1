import { type Collection } from 'mongodb';

import { type IImportRunDocument } from './import-run.types.js';

export async function ensureImportIndexes(
  collection: Collection<IImportRunDocument>,
): Promise<void> {
  await collection.createIndex({ importId: 1 }, { unique: true });
}
