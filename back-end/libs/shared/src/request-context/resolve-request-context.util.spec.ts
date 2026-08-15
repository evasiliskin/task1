import { resolveRequestContext } from './resolve-request-context.util.js';

const CORRELATION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

describe('resolveRequestContext', () => {
  it('should resolve context from valid headers, when both headers are present', () => {
    const result = resolveRequestContext({
      'x-correlation-id': CORRELATION_ID,
      'x-request-id': REQUEST_ID,
    });

    expect(result).toEqual({
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      correlationIdSource: 'inbound',
    });
  });

  it('should generate a correlation id and mark it "generated", when the header is missing', () => {
    const result = resolveRequestContext({});

    expect(result.correlationIdSource).toBe('generated');
    expect(result.correlationId).toHaveLength(36);
  });

  it('should generate a request id, when the header is missing', () => {
    const result = resolveRequestContext({ 'x-correlation-id': CORRELATION_ID });

    expect(result.requestId).toHaveLength(36);
  });

  it('should use the first value, when a header arrives as an array (repeated header)', () => {
    const result = resolveRequestContext({
      'x-correlation-id': [CORRELATION_ID, 'other-value'],
      'x-request-id': [REQUEST_ID, 'other-value'],
    });

    expect(result).toEqual({
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      correlationIdSource: 'inbound',
    });
  });

  it('should report "generated", when the correlation id header is rejected as not UUID-shaped', () => {
    const result = resolveRequestContext({ 'x-correlation-id': 'bad id\nwith newline' });

    expect(result.correlationIdSource).toBe('generated');
  });
});
