export interface ILogErrorInfoView {
  reason: string;
}

export interface ILogView {
  importId: string;
  eventType: string;
  service: string;
  status: string;
  timestamp: string;
  correlationId: string;
  archive: string;
  metadata: Record<string, number>;
  errorInfo?: ILogErrorInfoView;
}
