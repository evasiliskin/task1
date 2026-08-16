import { type IProcessingLogDocument } from '../processing-log.types.js';

export interface IStatsGroup {
  _id: string;
  count: number;
  eventsProcessed: number;
  validEvents: number;
  invalidEvents: number;
  errorCount: number;
}

export interface IMongoStats {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
}

const COMPLETED_STATUS = 'completed';
const FAILED_STATUS = 'failed';

export function shapeStats(groups: IStatsGroup[]): IMongoStats {
  const completed = groups.find((group) => group._id === COMPLETED_STATUS);
  const failed = groups.find((group) => group._id === FAILED_STATUS);

  return {
    archivesProcessed: completed?.count ?? 0,
    eventsProcessed: completed?.eventsProcessed ?? 0,
    successfulEvents: completed?.validEvents ?? 0,
    invalidEvents: completed?.invalidEvents ?? 0,
    errors: (failed?.count ?? 0) + (completed?.errorCount ?? 0),
  };
}

/**
 * The per-import counterpart of `shapeStats`.
 *
 * The `importId` branch already fetches its (at most four) documents, so grouping them server-side
 * as well was a second round trip for the same data. Both functions must agree — they describe the
 * same five figures, one from a `$group` and one from documents in hand.
 */
export function shapeStatsFromDocuments(documents: IProcessingLogDocument[]): IMongoStats {
  const completed = documents.find((document) => document.status === COMPLETED_STATUS);
  const failedCount = documents.filter((document) => document.status === FAILED_STATUS).length;

  return {
    archivesProcessed: completed === undefined ? 0 : 1,
    eventsProcessed: completed?.metadata.eventsProcessed ?? 0,
    successfulEvents: completed?.metadata.validEvents ?? 0,
    invalidEvents: completed?.metadata.invalidEvents ?? 0,
    errors: failedCount + (completed?.metadata.errorCount ?? 0),
  };
}
