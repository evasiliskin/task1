import { buildOutboundHeaders } from './propagation.util.js';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildOutboundHeaders', () => {
  it('should forward the correlation id unchanged', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    // eslint-disable-next-line security/detect-object-injection
    expect(headers[CORRELATION_ID_HEADER]).toBe('c-123');
  });

  it('should mint a fresh request id, distinct from the inbound request id', () => {
    const headers = buildOutboundHeaders({ correlationId: 'c-123', requestId: 'r-456' });

    // eslint-disable-next-line security/detect-object-injection
    expect(headers[REQUEST_ID_HEADER]).not.toBe('r-456');
    // eslint-disable-next-line security/detect-object-injection
    expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_PATTERN);
  });

  it('should mint a different request id on every call, given the same context', () => {
    const context = { correlationId: 'c-123', requestId: 'r-456' };

    const first = buildOutboundHeaders(context);
    const second = buildOutboundHeaders(context);

    // eslint-disable-next-line security/detect-object-injection
    expect(first[REQUEST_ID_HEADER]).not.toBe(second[REQUEST_ID_HEADER]);
  });
});
