import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from './processing-log-collection.provider.js';
import { type IProcessingLogDocument } from './processing-log.types.js';
import { StatsRollupTracker } from './stats/stats-rollup.tracker.js';

@Injectable()
export class ProcessingLogTracker {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
    private readonly statsRollup: StatsRollupTracker,
  ) {}

  public async upsertLog(entry: IProcessingLogDocument): Promise<void> {
    await this.collection.updateOne(
      { importId: entry.importId, status: entry.status },
      { $set: entry },
      { upsert: true },
    );

    const rollupId = randomUUID();

    const claim = await this.collection.updateOne(
      { importId: entry.importId, status: entry.status, rollupId: { $exists: false } },
      { $set: { rollupId } },
    );

    if (claim.modifiedCount !== 1) {
      return;
    }

    try {
      await this.statsRollup.applyEntry(entry);
    } catch (error) {
      await this.collection.updateOne(
        { importId: entry.importId, status: entry.status, rollupId },
        { $unset: { rollupId: '' } },
      );

      throw error;
    }

    await this.collection.updateOne(
      { importId: entry.importId, status: entry.status, rollupId },
      { $set: { rolledUpAt: new Date() } },
    );
  }
}
