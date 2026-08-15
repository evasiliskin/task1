import { resolveRequestContext } from './resolve-request-context.util.js';

describe('resolveRequestContext', () => {
  it('should resolve context from valid headers, when both headers are present', () => {
    const result = resolveRequestContext({
      'x-correlation-id': 'abc-123',
      'x-request-id': 'req-456',
    });

    expect(result).toEqual({
      correlationId: 'abc-123',
      requestId: 'req-456',
      correlationIdSource: 'inbound',
    });
  });

  it('should generate a correlation id and mark it "generated", when the header is missing', () => {
    const result = resolveRequestContext({});

    expect(result.correlationIdSource).toBe('generated');
    expect(result.correlationId).toHaveLength(36);
  });

  it('should generate a request id, when the header is missing', () => {
    const result = resolveRequestContext({ 'x-correlation-id': 'abc-123' });

    expect(result.requestId).toHaveLength(36);
  });

  it('should use the first value, when a header arrives as an array (repeated header)', () => {
    const result = resolveRequestContext({
      'x-correlation-id': ['abc-123', 'other-value'],
      'x-request-id': ['req-456', 'other-value'],
    });

    expect(result).toEqual({
      correlationId: 'abc-123',
      requestId: 'req-456',
      correlationIdSource: 'inbound',
    });
  });

  it('should report "generated", when the correlation id header is rejected as unsafe', () => {
    const result = resolveRequestContext({ 'x-correlation-id': 'bad id\nwith newline' });

    expect(result.correlationIdSource).toBe('generated');
  });
});
