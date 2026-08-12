import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

export async function ensureEventIndexes(
  collection: Collection<IGithubEventDocument>,
): Promise<void> {
  await collection.createIndex({ eventId: 1 }, { unique: true });
}
