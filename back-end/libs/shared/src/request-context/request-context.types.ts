export type CorrelationIdSource = 'inbound' | 'generated';

export interface IRequestContext {
  correlationId: string;
  requestId: string;
  /**
   * Whether `correlationId` arrived on the wire or had to be minted here. A `generated` value on
   * an inbound RMQ message means an upstream publisher failed to propagate the header and the
   * trace chain is broken at that hop — alert on it.
   */
  correlationIdSource: CorrelationIdSource;
  /**
   * Set only for work that has no inbound request — a sweep, a startup task. Distinguishes a
   * legitimately-rooted trace from the `correlationIdSource: 'generated'` alert condition, which
   * on the `rmq` channel means an upstream publisher dropped the header.
   */
  operation?: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
