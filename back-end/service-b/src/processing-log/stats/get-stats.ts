import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import {
  deriveImportDurationStats,
  type IImportTimeSeriesPoint,
} from './derive-import-duration-stats.js';
import { shapeStats, type IMongoStats, type IStatsGroup } from './shape-stats.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';

const FAILED_READ_MONGO_STATS_LOG = 'Failed to read processing-log stats from MongoDB';

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

interface IMongoStatsResult {
  stats: IMongoStats;
  degraded: boolean;
}

async function readMongoStats(
  collection: Collection<IProcessingLogDocument>,
  importId: string | undefined,
  logger?: AppLogger,
): Promise<IMongoStatsResult> {
  try {
    const groups = await collection.aggregate<IStatsGroup>(buildStatsPipeline(importId)).toArray();

    return { stats: shapeStats(groups), degraded: false };
  } catch (error) {
    logger?.warn({ importId }, FAILED_READ_MONGO_STATS_LOG, error);

    return { stats: EMPTY_MONGO_STATS, degraded: true };
  }
}

export async function getStats(
  collection: Collection<IProcessingLogDocument>,
  metricsReader: StatsMetricsReader,
  importId?: string,
  logger?: AppLogger,
): Promise<IStatsResult> {
  const mongoStats = await readMongoStats(collection, importId, logger);

  if (importId === undefined) {
    const [durationResult, timeSeriesResult] = await Promise.all([
      metricsReader.readAverageProcessingDuration(),
      metricsReader.readEventsTimeSeries(),
    ]);

    return {
      ...mongoStats.stats,
      ...(durationResult.value === undefined ? {} : { processingDurationMs: durationResult.value }),
      timeSeries: timeSeriesResult.timeSeries,
      degraded: mongoStats.degraded || durationResult.degraded || timeSeriesResult.degraded,
    };
  }

  let documents: IProcessingLogDocument[];
  let findDegraded = false;

  try {
    // The unique {importId, status} index ensures at most 4 documents (one per status enum value).
    documents = await collection.find({ importId }).limit(MAX_STATUSES_PER_IMPORT).toArray();
  } catch (error) {
    logger?.warn({ importId }, FAILED_READ_MONGO_STATS_LOG, error);
    documents = [];
    findDegraded = true;
  }

  const importDurationStats = deriveImportDurationStats(documents);

  return {
    ...mongoStats.stats,
    ...(importDurationStats.processingDurationMs === undefined
      ? {}
      : { processingDurationMs: importDurationStats.processingDurationMs }),
    timeSeries: importDurationStats.timeSeries,
    degraded: mongoStats.degraded || findDegraded,
  };
}
