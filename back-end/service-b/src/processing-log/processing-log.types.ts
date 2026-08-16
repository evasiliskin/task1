export type ProcessingLogStatus = 'started' | 'completed' | 'failed' | 'dead-lettered';

export interface IProcessingLogErrorInfo {
  reason: string;
}

export interface IProcessingLogDocument {
  importId: string;
  eventType: string;
  service: 'service-a';
  status: ProcessingLogStatus;
  timestamp: Date;
  correlationId: string;
  archive: string;
  metadata: Record<string, number>;
  errorInfo?: IProcessingLogErrorInfo;
  /**
   * Set only after `StatsRollupTracker.applyEntry` has actually succeeded for this entry. Not a
   * domain field — a retry-safety marker so a redelivered entry whose rollup increment failed can
   * be retried, instead of being silently skipped forever because the log document already exists.
   */
  rolledUpAt?: Date;
}
