import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

export async function ensureEventIndexes(
  collection: Collection<IGithubEventDocument>,
): Promise<void> {
  await Promise.all([
    collection.createIndex({ eventId: 1 }, { unique: true }),
    collection.createIndex({ createdAt: -1, eventId: -1 }),
    collection.createIndex({ eventType: 1, createdAt: -1, eventId: -1 }),
    collection.createIndex({ 'repo.name': 1, createdAt: -1, eventId: -1 }),
    collection.createIndex({ 'actor.login': 1, createdAt: -1, eventId: -1 }),
  ]);
}
