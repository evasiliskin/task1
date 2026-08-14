import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

export async function ensureEventIndexes(
  collection: Collection<IGithubEventDocument>,
): Promise<void> {
  await collection.createIndex({ eventId: 1 }, { unique: true });
  await collection.createIndex({ createdAt: -1, eventId: -1 });
  await collection.createIndex({ eventType: 1, createdAt: -1, eventId: -1 });
  await collection.createIndex({ 'repo.name': 1, createdAt: -1, eventId: -1 });
  await collection.createIndex({ 'actor.login': 1, createdAt: -1, eventId: -1 });
}
