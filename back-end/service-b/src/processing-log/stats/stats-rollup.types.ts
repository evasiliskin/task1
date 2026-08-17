import { type IMongoStats } from './shape-stats.js';

export const STATS_ROLLUP_ID = 'processing-log';

export interface IStatsRollupDocument extends IMongoStats {
  _id: string;
  seededAt?: Date;
  appliedEntries?: string[];
}
