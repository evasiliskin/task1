import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import {
  deriveImportDurationStats,
  type IImportTimeSeriesPoint,
} from './derive-import-duration-stats.js';
import { shapeStats, type IStatsGroup } from './shape-stats.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';

export interface IStatsResult {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
  processingDurationMs?: number;
  timeSeries: IImportTimeSeriesPoint[];
}

export async function getStats(
  collection: Collection<IProcessingLogDocument>,
  metricsReader: StatsMetricsReader,
  importId?: string,
): Promise<IStatsResult> {
  const groups = await collection.aggregate<IStatsGroup>(buildStatsPipeline(importId)).toArray();
  const mongoStats = shapeStats(groups);

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

  const documents = await collection.find({ importId }).toArray();
  const importDurationStats = deriveImportDurationStats(documents);

  return {
    ...mongoStats,
    ...(importDurationStats.processingDurationMs === undefined
      ? {}
      : { processingDurationMs: importDurationStats.processingDurationMs }),
    timeSeries: importDurationStats.timeSeries,
  };
}
