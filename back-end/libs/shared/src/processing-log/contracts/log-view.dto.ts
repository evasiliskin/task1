export interface ILogErrorInfoView {
  reason: string;
}

/** What `logs.search` puts on the wire; `timestamp` is an ISO string, and `_id` never leaves. */
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
