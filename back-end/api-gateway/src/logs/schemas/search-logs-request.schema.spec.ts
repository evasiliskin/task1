import { SearchLogsRequestSchema } from './search-logs-request.schema.js';

describe('SearchLogsRequestSchema', () => {
  it('should default limit to 50, when no query params are provided', () => {
    const result = SearchLogsRequestSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.query.limit).toBe(50);
  });

  it('should accept every field, when well-formed', () => {
    const result = SearchLogsRequestSchema.safeParse({
      query: {
        importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        status: 'completed',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-11T00:00:00.000Z',
        cursor: 'some-cursor',
        limit: '25',
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.query.limit).toBe(25);
  });

  it('should reject a limit exceeding 200, when parsed', () => {
    const result = SearchLogsRequestSchema.safeParse({ query: { limit: '201' } });

    expect(result.success).toBe(false);
  });

  it('should reject a non-uuid importId, when parsed', () => {
    const result = SearchLogsRequestSchema.safeParse({ query: { importId: 'not-a-uuid' } });

    expect(result.success).toBe(false);
  });

  it('should reject an unknown status value, when parsed', () => {
    const result = SearchLogsRequestSchema.safeParse({ query: { status: 'unknown' } });

    expect(result.success).toBe(false);
  });

  it('should accept status "dead-lettered", when parsed', () => {
    const result = SearchLogsRequestSchema.safeParse({ query: { status: 'dead-lettered' } });

    expect(result.success).toBe(true);
  });

  it('should reject a from value that is not a valid ISO-8601 datetime, when parsed', () => {
    const result = SearchLogsRequestSchema.safeParse({ query: { from: 'not-a-date' } });

    expect(result.success).toBe(false);
  });
});
