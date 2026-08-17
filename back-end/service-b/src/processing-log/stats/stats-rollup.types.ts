import { type IMongoStats } from './shape-stats.js';

export const STATS_ROLLUP_ID = 'processing-log';

export const APPLIED_ENTRIES_HISTORY = 1000;

export interface IStatsRollupDocument extends IMongoStats {
  _id: string;
  seededAt?: Date;
  appliedEntries?: string[];
}
