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
    // Partial, so the many runs without an Idempotency-Key do not all collide on a missing value.
    collection.createIndex(
      { idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
    ),
    // Serves expireStaleClaims's sweep for reservations that were claimed but never started.
    // Partial on claimedAt existing, mirroring the idempotencyKey index above — MongoDB's
    // partialFilterExpression only supports `$exists: true`, not `$exists: false`, so the sweep's
    // `startedAt: { $exists: false }` clause cannot be expressed in the index itself. The index
    // still narrows the scan to claimed rows and serves the `claimedAt: { $lt: cutoff }` range;
    // MongoDB filters the remaining `startedAt` condition against that narrowed set.
    collection.createIndex(
      { claimedAt: 1 },
      { partialFilterExpression: { claimedAt: { $exists: true } } },
    ),
  ]);
}
