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

export function toStatsGroups(documents: IProcessingLogDocument[]): IStatsGroup[] {
  const groupsByStatus = new Map<string, IStatsGroup>();

  for (const document of documents) {
    const group = groupsByStatus.get(document.status) ?? {
      _id: document.status,
      count: 0,
      eventsProcessed: 0,
      validEvents: 0,
      invalidEvents: 0,
      errorCount: 0,
    };

    group.count += 1;
    group.eventsProcessed += document.metadata.eventsProcessed ?? 0;
    group.validEvents += document.metadata.validEvents ?? 0;
    group.invalidEvents += document.metadata.invalidEvents ?? 0;
    group.errorCount += document.metadata.errorCount ?? 0;

    groupsByStatus.set(document.status, group);
  }

  return [...groupsByStatus.values()];
}

export function shapeStatsFromDocuments(documents: IProcessingLogDocument[]): IMongoStats {
  return shapeStats(toStatsGroups(documents));
}
