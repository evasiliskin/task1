import { GetStatsRequestSchema } from './get-stats-request.schema.js';

describe('GetStatsRequestSchema', () => {
  it('should accept an empty payload, when parsed', () => {
    const result = GetStatsRequestSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('should accept a uuid importId, when parsed', () => {
    const result = GetStatsRequestSchema.safeParse({
      query: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    });

    expect(result.success).toBe(true);
  });

  it('should reject a non-uuid importId, when parsed', () => {
    const result = GetStatsRequestSchema.safeParse({ query: { importId: 'not-a-uuid' } });

    expect(result.success).toBe(false);
  });
});
