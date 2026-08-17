export type CorrelationIdSource = 'inbound' | 'generated';

export interface IRequestContext {
  correlationId: string;
  requestId: string;
  correlationIdSource: CorrelationIdSource;
  operation?: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
