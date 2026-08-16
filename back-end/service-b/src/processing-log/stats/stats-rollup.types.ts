import { type IMongoStats } from './shape-stats.js';

/** Singleton: one document holds the all-time totals for the whole collection. */
export const STATS_ROLLUP_ID = 'processing-log';

export interface IStatsRollupDocument extends IMongoStats {
  _id: string;
  /** Set once by the seeder; its presence is what stops a later boot re-seeding. */
  seededAt?: Date;
}
