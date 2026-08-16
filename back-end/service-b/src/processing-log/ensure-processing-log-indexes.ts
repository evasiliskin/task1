import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The index definitions are independent, so they are created concurrently rather than in four
 * serialised round trips.
 *
 * The TTL index is deliberately NOT created here — see `ensureProcessingLogRetentionIndex` below.
 */
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

/**
 * Bounds the collection with a TTL index on `timestamp`. Aggregate `/stats` totals are unaffected
 * by expiry because they are served from the cumulative rollup, not by re-scanning this
 * collection — which is a second reason the rollup exists. Per-import queries for an expired
 * import legitimately return nothing.
 *
 * Kept separate from `ensureProcessingLogIndexes` and created only after `StatsRollupSeedService`'s
 * one-time backfill aggregation has read the collection. MongoDB's TTL monitor can sweep at any
 * point once this index exists — not only after a fixed warm-up — so creating it any earlier risks
 * the monitor deleting history before the seed counts it, which would be a silent, permanent
 * undercount (the seed runs at most once, gated on `seededAt`).
 */
export async function ensureProcessingLogRetentionIndex(
  collection: Collection<IProcessingLogDocument>,
  retentionMs: number,
): Promise<void> {
  await collection.createIndex(
    { timestamp: 1 },
    // MongoDB's TTL granularity is whole seconds; its monitor runs about once a minute, so
    // deletion is approximate by design.
    { expireAfterSeconds: Math.max(1, Math.round(retentionMs / MILLISECONDS_PER_SECOND)) },
  );
}
