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
    const key = { importId: entry.importId, status: entry.status };

    const stored = await this.collection.findOneAndUpdate(
      key,
      { $set: entry },
      { upsert: true, returnDocument: 'after' },
    );

    if (stored?.rolledUpAt !== undefined) {
      return;
    }

    await this.statsRollup.applyEntry(entry);

    await this.collection.updateOne(key, { $set: { rolledUpAt: new Date() } });
  }
}
