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
  rolledUpAt?: Date;
}
