import { type IProcessingLogDocument } from '../processing-log.types.js';

import { type IMongoStats } from './shape-stats.js';

export function buildRollupDelta(entry: IProcessingLogDocument): Partial<IMongoStats> {
  if (entry.status === 'failed') {
    return { errors: 1 };
  }

  if (entry.status !== 'completed') {
    return {};
  }

  return {
    archivesProcessed: 1,
    eventsProcessed: entry.metadata.eventsProcessed ?? 0,
    successfulEvents: entry.metadata.validEvents ?? 0,
    invalidEvents: entry.metadata.invalidEvents ?? 0,
    errors: entry.metadata.errorCount ?? 0,
  };
}
