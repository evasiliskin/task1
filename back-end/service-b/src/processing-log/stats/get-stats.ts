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
}

async function readMongoStats(
  collection: Collection<IProcessingLogDocument>,
  importId: string | undefined,
  logger?: AppLogger,
): Promise<IMongoStats> {
  try {
    const groups = await collection.aggregate<IStatsGroup>(buildStatsPipeline(importId)).toArray();

    return shapeStats(groups);
  } catch (error) {
    logger?.warn(
      { importId, error: error instanceof Error ? error.message : String(error) },
      FAILED_READ_MONGO_STATS_LOG,
    );

    return EMPTY_MONGO_STATS;
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
    const [processingDurationMs, timeSeries] = await Promise.all([
      metricsReader.readAverageProcessingDuration(),
      metricsReader.readEventsTimeSeries(),
    ]);

    return {
      ...mongoStats,
      ...(processingDurationMs === undefined ? {} : { processingDurationMs }),
      timeSeries,
    };
  }

  let documents: IProcessingLogDocument[];

  try {
    documents = await collection.find({ importId }).toArray();
  } catch (error) {
    logger?.warn(
      { importId, error: error instanceof Error ? error.message : String(error) },
      FAILED_READ_MONGO_STATS_LOG,
    );
    documents = [];
  }

  const importDurationStats = deriveImportDurationStats(documents);

  return {
    ...mongoStats,
    ...(importDurationStats.processingDurationMs === undefined
      ? {}
      : { processingDurationMs: importDurationStats.processingDurationMs }),
    timeSeries: importDurationStats.timeSeries,
  };
}
