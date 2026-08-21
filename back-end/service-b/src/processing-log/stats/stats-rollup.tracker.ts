import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildAppliedEntryKey } from './applied-entry-key.js';
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

  public async applyEntry(entry: IProcessingLogDocument): Promise<void> {
    const delta = buildRollupDelta(entry);

    if (Object.keys(delta).length === 0) {
      return;
    }

    await this.collection.updateOne(
      { _id: STATS_ROLLUP_ID },
      { $setOnInsert: { appliedEntries: [] } },
      { upsert: true },
    );

    const appliedEntry = buildAppliedEntryKey(entry);

    await this.collection.updateOne(
      { _id: STATS_ROLLUP_ID, appliedEntries: { $ne: appliedEntry } },
      { $inc: delta, $push: { appliedEntries: appliedEntry } },
    );
  }

  public async read(): Promise<IMongoStats | undefined> {
    const document = await this.collection.findOne(
      { _id: STATS_ROLLUP_ID },
      { projection: { appliedEntries: 0 } },
    );

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
