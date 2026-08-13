import { type IProcessingLogDocument } from '../processing-log.types.js';

export interface IImportTimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface IImportDurationStats {
  processingDurationMs?: number;
  timeSeries: IImportTimeSeriesPoint[];
}

export function deriveImportDurationStats(
  documents: IProcessingLogDocument[],
): IImportDurationStats {
  const started = documents.find((document) => document.status === 'started');
  const completed = documents.find((document) => document.status === 'completed');

  if (started === undefined || completed === undefined) {
    return { timeSeries: [] };
  }

  return {
    processingDurationMs: completed.timestamp.getTime() - started.timestamp.getTime(),
    timeSeries: [
      {
        timestamp: completed.timestamp.toISOString(),
        value: completed.metadata.eventsProcessed,
      },
    ],
  };
}
