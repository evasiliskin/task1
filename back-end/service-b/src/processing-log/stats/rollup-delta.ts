import { type IProcessingLogDocument } from '../processing-log.types.js';

import { shapeStatsFromDocuments, type IMongoStats } from './shape-stats.js';

export function buildRollupDelta(entry: IProcessingLogDocument): Partial<IMongoStats> {
  const contribution = shapeStatsFromDocuments([entry]);

  return Object.fromEntries(Object.entries(contribution).filter(([, value]) => value !== 0));
}
