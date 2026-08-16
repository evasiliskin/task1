import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type Collection } from 'mongodb';

import mongodbConfig, { type MongodbConfiguration } from '../../config/mongodb.config.js';
import { ensureProcessingLogRetentionIndex } from '../ensure-processing-log-indexes.js';
import { PROCESSING_LOG_COLLECTION } from '../processing-log-collection.provider.js';
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import { shapeStats, type IStatsGroup } from './shape-stats.js';
import { STATS_ROLLUP_COLLECTION } from './stats-rollup-collection.provider.js';
import { STATS_ROLLUP_ID, type IStatsRollupDocument } from './stats-rollup.types.js';

const SEEDED_LOG = 'Seeded the processing-log stats rollup from existing history';
const SEED_FAILED_LOG =
  'Could not seed the stats rollup; aggregate statistics will fall back to a full scan until it succeeds';

/**
 * Backfills the all-time totals once, so introducing the rollup preserves existing history instead
 * of resetting it to zero.
 *
 * Gated on `seededAt`, not on the document's absence: `StatsRollupTracker.applyEntry` upserts, so a
 * partial rollup can exist before the first seed. `$set`ting the authoritative aggregate is safe
 * even when some of those events are already counted, because it replaces rather than adds.
 *
 * The processing-logs TTL index is created here, AFTER the seed attempt, rather than alongside the
 * collection's other indexes at module-init time — see `ensureProcessingLogRetentionIndex`'s doc
 * comment for why: creating it earlier risks MongoDB's TTL monitor deleting history before this
 * one-time backfill counts it.
 */
@Injectable()
export class StatsRollupSeedService implements OnApplicationBootstrap {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly processingLogs: Collection<IProcessingLogDocument>,
    @Inject(STATS_ROLLUP_COLLECTION)
    private readonly rollups: Collection<IStatsRollupDocument>,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
    @Inject(mongodbConfig.KEY) private readonly mongodbConfiguration: MongodbConfiguration,
  ) {
    this.logger = loggerService.getLogger(StatsRollupSeedService.name);
  }

  public async onApplicationBootstrap(): Promise<void> {
    await this.requestContextService.runAsRoot('stats-rollup-seed', () => this.seed());

    // Not wrapped in try/catch: an index-creation failure fails startup closed, consistent with
    // how index creation has always behaved elsewhere in this codebase (ensureImportIndexes,
    // ensureEventIndexes, and the non-TTL processing-log indexes all block boot on failure).
    await ensureProcessingLogRetentionIndex(
      this.processingLogs,
      this.mongodbConfiguration.processingLogRetentionMs,
    );
  }

  private readonly logger: AppLogger;

  private async seed(): Promise<void> {
    try {
      const existing = await this.rollups.findOne({ _id: STATS_ROLLUP_ID });

      if (existing?.seededAt !== undefined) {
        return;
      }

      const groups = await this.processingLogs
        .aggregate<IStatsGroup>(buildStatsPipeline())
        .toArray();
      const totals = shapeStats(groups);

      await this.rollups.updateOne(
        { _id: STATS_ROLLUP_ID },
        { $set: { ...totals, seededAt: new Date() } },
        { upsert: true },
      );

      this.logger.info({ ...totals }, SEEDED_LOG);
    } catch (error) {
      // Never fatal: `getAggregateStats` falls back to the live aggregation while the rollup is
      // unseeded, so a failed seed degrades performance, not correctness.
      this.logger.warn({}, SEED_FAILED_LOG, error);
    }
  }
}
