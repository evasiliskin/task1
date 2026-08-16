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

    // The rollup delta must be applied at most once per {importId, status}, but "was this entry
    // newly inserted" (the old signal) and "has this entry's rollup contribution actually been
    // applied" are different questions — a failed applyEntry after a genuine insert must still be
    // retried on redelivery. `rolledUpAt` on the log document itself is the retry-safe claim: this
    // atomic filter-and-set can only succeed for one caller per {importId, status} at a time (the
    // unique index on those fields plus Mongo's per-document atomicity rule out a double claim),
    // and it stays claimable across retries for as long as applyEntry keeps failing.
    const claim = await this.collection.updateOne(
      { importId: entry.importId, status: entry.status, rolledUpAt: { $exists: false } },
      { $set: { rolledUpAt: new Date() } },
    );

    if (claim.modifiedCount !== 1) {
      // Already applied (or claimed) by an earlier attempt — this is the redelivery no-op case.
      return;
    }

    try {
      await this.statsRollup.applyEntry(entry);
    } catch (error) {
      // Release the claim so a future redelivery can retry the increment instead of losing this
      // entry's contribution permanently.
      await this.collection.updateOne(
        { importId: entry.importId, status: entry.status },
        { $unset: { rolledUpAt: '' } },
      );

      throw error;
    }
  }
}
