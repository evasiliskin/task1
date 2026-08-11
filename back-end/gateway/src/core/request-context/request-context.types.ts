export interface IRequestContext {
  correlationId: string;
  requestId: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const MAX_ID_LENGTH = 200;
