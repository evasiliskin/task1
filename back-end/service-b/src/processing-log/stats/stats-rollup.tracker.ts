import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildRollupDelta } from './rollup-delta.js';
import { type IMongoStats } from './shape-stats.js';
import { STATS_ROLLUP_COLLECTION } from './stats-rollup-collection.provider.js';
import { STATS_ROLLUP_ID, type IStatsRollupDocument } from './stats-rollup.types.js';

@Injectable()
export class StatsRollupTracker {
  public constructor(
    @Inject(STATS_ROLLUP_COLLECTION)
    private readonly collection: Collection<IStatsRollupDocument>,
  ) {}

  /**
   * Adds one newly recorded entry to the all-time totals.
   *
   * The caller must only invoke this once it has atomically claimed the entry (its `rolledUpAt`
   * marker), and must revert that claim if this call throws. `$inc` is not idempotent, so an
   * unguarded or unclaimed call would inflate the totals under RabbitMQ redelivery — see
   * `ProcessingLogTracker.upsertLog`'s claim/revert logic, which is what makes calling this safe.
   */
  public async applyEntry(entry: IProcessingLogDocument): Promise<void> {
    const delta = buildRollupDelta(entry);

    if (Object.keys(delta).length === 0) {
      return;
    }

    await this.collection.updateOne({ _id: STATS_ROLLUP_ID }, { $inc: delta }, { upsert: true });
  }

  public async read(): Promise<IMongoStats | undefined> {
    const document = await this.collection.findOne({ _id: STATS_ROLLUP_ID });

    // A document can exist without ever having been seeded: `applyEntry`'s `upsert: true` lets a
    // `$inc` create it before `StatsRollupSeedService`'s backfill runs (e.g. the seeder failed at
    // bootstrap). Treat that the same as "no document" so the caller falls back to a full scan
    // instead of serving a partial, under-reported total as if it were authoritative.
    if (document?.seededAt === undefined) {
      return undefined;
    }

    return {
      archivesProcessed: document.archivesProcessed ?? 0,
      eventsProcessed: document.eventsProcessed ?? 0,
      successfulEvents: document.successfulEvents ?? 0,
      invalidEvents: document.invalidEvents ?? 0,
      errors: document.errors ?? 0,
    };
  }
}
