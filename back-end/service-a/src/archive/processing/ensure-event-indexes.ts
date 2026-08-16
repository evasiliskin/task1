import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

/**
 * The index definitions are independent, so they are created concurrently rather than in eleven
 * serialised round trips across the three ensure functions. Safe parallelism: no shared state, and
 * MongoDB builds indexes on distinct keys concurrently.
 */
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
