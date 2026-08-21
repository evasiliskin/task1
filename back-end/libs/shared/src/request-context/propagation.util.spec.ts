import { buildOutboundHeaders } from './propagation.util.js';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildOutboundHeaders', () => {
  it('should forward the correlation id unchanged, when headers are built', () => {
    const headers = buildOutboundHeaders({
      correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      correlationIdSource: 'inbound',
    });

    // eslint-disable-next-line security/detect-object-injection
    expect(headers[CORRELATION_ID_HEADER]).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('should mint a request id distinct from the inbound one, when headers are built', () => {
    const headers = buildOutboundHeaders({
      correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      correlationIdSource: 'inbound',
    });

    // eslint-disable-next-line security/detect-object-injection
    expect(headers[REQUEST_ID_HEADER]).not.toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
    // eslint-disable-next-line security/detect-object-injection
    expect(headers[REQUEST_ID_HEADER]).toMatch(UUID_V4_PATTERN);
  });

  it('should mint a different request id on every call, when the context is unchanged', () => {
    const context = {
      correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      correlationIdSource: 'inbound' as const,
    };

    const first = buildOutboundHeaders(context);
    const second = buildOutboundHeaders(context);

    // eslint-disable-next-line security/detect-object-injection
    expect(first[REQUEST_ID_HEADER]).not.toBe(second[REQUEST_ID_HEADER]);
  });
});
