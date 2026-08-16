import { type IProcessingLogDocument } from '../processing-log.types.js';

import { type IMongoStats } from './shape-stats.js';

/**
 * What one newly recorded log entry adds to the all-time totals.
 *
 * Mirrors `shapeStats` term for term — that function derives the same figures by grouping the whole
 * collection, and the two must agree or the rollup silently drifts from the numbers it replaced.
 * `started` and `dead-lettered` entries contribute nothing, exactly as the grouping ignores them.
 */
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
