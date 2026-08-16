export type ImportStatusSourceView =
  | { readonly type: 'download'; readonly archive: string }
  | { readonly type: 'upload'; readonly filename: string };

/** What `imports.status.get` puts on the wire; timestamps are ISO strings, not `Date`s. */
export interface IImportStatusView {
  importId: string;
  source: ImportStatusSourceView;
  status: 'started' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  eventsProcessed?: number;
  validEvents?: number;
  invalidEvents?: number;
  duplicateEvents?: number;
  errorCount?: number;
  errorSamples?: string[];
}
