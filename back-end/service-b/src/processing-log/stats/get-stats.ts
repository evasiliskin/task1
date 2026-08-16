import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type Collection, MongoNetworkError, MongoServerSelectionError } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import {
  deriveImportDurationStats,
  type IImportTimeSeriesPoint,
} from './derive-import-duration-stats.js';
import {
  shapeStats,
  shapeStatsFromDocuments,
  type IMongoStats,
  type IStatsGroup,
} from './shape-stats.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';
import { type StatsRollupTracker } from './stats-rollup.tracker.js';

const FAILED_READ_MONGO_STATS_LOG = 'Failed to read processing-log stats from MongoDB';

/** The unique {importId, status} index caps an import at one document per status enum value. */
const MAX_STATUSES_PER_IMPORT = 4;

const EMPTY_MONGO_STATS: IMongoStats = {
  archivesProcessed: 0,
  eventsProcessed: 0,
  successfulEvents: 0,
  invalidEvents: 0,
  errors: 0,
};

export interface IStatsResult {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
  processingDurationMs?: number;
  timeSeries: IImportTimeSeriesPoint[];
  degraded: boolean;
}

export interface IGetStatsOptions {
  collection: Collection<IProcessingLogDocument>;
  rollup: StatsRollupTracker;
  metricsReader: StatsMetricsReader;
  importId?: string;
  logger?: AppLogger;
}

/**
 * Only an unreachable database degrades a result. A `TypeError` from a malformed pipeline is a bug,
 * and reporting it as `degraded: true` made that class of defect invisible in production.
 */
function isInfrastructureFailure(error: unknown): boolean {
  return error instanceof MongoNetworkError || error instanceof MongoServerSelectionError;
}

async function readAggregateTotals(
  options: IGetStatsOptions,
): Promise<{ stats: IMongoStats; degraded: boolean }> {
  try {
    const rolledUp = await options.rollup.read();

    if (rolledUp !== undefined) {
      return { stats: rolledUp, degraded: false };
    }

    // Unseeded rollup: fall back to the scan so the endpoint still answers during the cutover.
    const groups = await options.collection.aggregate<IStatsGroup>(buildStatsPipeline()).toArray();

    return { stats: shapeStats(groups), degraded: false };
  } catch (error) {
    if (!isInfrastructureFailure(error)) {
      throw error;
    }

    options.logger?.warn({}, FAILED_READ_MONGO_STATS_LOG, error);

    return { stats: EMPTY_MONGO_STATS, degraded: true };
  }
}

async function getAggregateStats(options: IGetStatsOptions): Promise<IStatsResult> {
  const [totals, durationResult, timeSeriesResult] = await Promise.all([
    readAggregateTotals(options),
    options.metricsReader.readAverageProcessingDuration(),
    options.metricsReader.readEventsTimeSeries(),
  ]);

  return {
    ...totals.stats,
    ...(durationResult.value === undefined ? {} : { processingDurationMs: durationResult.value }),
    timeSeries: timeSeriesResult.timeSeries,
    degraded: totals.degraded || durationResult.degraded || timeSeriesResult.degraded,
  };
}

async function getImportStats(
  options: IGetStatsOptions & { importId: string },
): Promise<IStatsResult> {
  let documents: IProcessingLogDocument[] = [];
  let degraded = false;

  try {
    documents = await options.collection
      .find({ importId: options.importId })
      .limit(MAX_STATUSES_PER_IMPORT)
      .toArray();
  } catch (error) {
    if (!isInfrastructureFailure(error)) {
      throw error;
    }

    options.logger?.warn({ importId: options.importId }, FAILED_READ_MONGO_STATS_LOG, error);
    degraded = true;
  }

  const durationStats = deriveImportDurationStats(documents);

  return {
    // One query serves both the totals and the duration; the aggregation that used to run first is
    // redundant for a single import whose documents are already in hand.
    ...shapeStatsFromDocuments(documents),
    ...(durationStats.processingDurationMs === undefined
      ? {}
      : { processingDurationMs: durationStats.processingDurationMs }),
    timeSeries: durationStats.timeSeries,
    degraded,
  };
}

export async function getStats(options: IGetStatsOptions): Promise<IStatsResult> {
  return options.importId === undefined
    ? await getAggregateStats(options)
    : await getImportStats({ ...options, importId: options.importId });
}
