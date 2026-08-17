export type ImportSourceRecord =
  | { readonly type: 'download'; readonly archive: string }
  | { readonly type: 'upload'; readonly filename: string };

export type ImportRunStatus = 'started' | 'completed' | 'failed';

export interface IImportRunDocument {
  importId: string;
  source: ImportSourceRecord;
  status: ImportRunStatus;
  startedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  eventsProcessed?: number;
  validEvents?: number;
  invalidEvents?: number;
  duplicateEvents?: number;
  errorCount?: number;
  errorSamples?: string[];
  idempotencyKey?: string;
  claimedAt?: Date;
}
