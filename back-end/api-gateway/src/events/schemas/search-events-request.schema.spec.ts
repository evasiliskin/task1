import { SearchEventsRequestSchema } from './search-events-request.schema.js';

describe('SearchEventsRequestSchema', () => {
  it('should default limit to 50, when no query params are provided', () => {
    const result = SearchEventsRequestSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.query.limit).toBe(50);
  });

  it('should accept every field, when well-formed', () => {
    const result = SearchEventsRequestSchema.safeParse({
      query: {
        type: 'PushEvent',
        repository: 'octocat/hello-world',
        actor: 'octocat',
        importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-11T00:00:00.000Z',
        cursor: 'some-cursor',
        limit: '25',
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.query.limit).toBe(25);
  });

  it('should reject an importId that is not a valid UUID, when parsed', () => {
    const result = SearchEventsRequestSchema.safeParse({ query: { importId: 'not-a-uuid' } });

    expect(result.success).toBe(false);
  });

  it('should reject a limit exceeding 200, when parsed', () => {
    const result = SearchEventsRequestSchema.safeParse({ query: { limit: '201' } });

    expect(result.success).toBe(false);
  });

  it('should reject a limit of zero, when parsed', () => {
    const result = SearchEventsRequestSchema.safeParse({ query: { limit: '0' } });

    expect(result.success).toBe(false);
  });

  it('should reject a from value that is not a valid ISO-8601 datetime, when parsed', () => {
    const result = SearchEventsRequestSchema.safeParse({ query: { from: 'not-a-date' } });

    expect(result.success).toBe(false);
  });

  it('should reject an unexpected query key, when parsed', () => {
    const result = SearchEventsRequestSchema.safeParse({ query: { unknown: 'value' } });

    expect(result.success).toBe(false);
  });
});
