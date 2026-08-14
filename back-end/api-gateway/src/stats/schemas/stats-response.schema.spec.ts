import { StatsResponseSchema } from './stats-response.schema.js';

describe('StatsResponseSchema', () => {
  it('should accept a full payload, when parsed', () => {
    const result = StatsResponseSchema.safeParse({
      archivesProcessed: 12,
      eventsProcessed: 48_000,
      successfulEvents: 47_500,
      invalidEvents: 500,
      errors: 3,
      processingDurationMs: 15_230,
      timeSeries: [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }],
    });

    expect(result.success).toBe(true);
  });

  it('should accept a payload without processingDurationMs, when parsed', () => {
    const result = StatsResponseSchema.safeParse({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    });

    expect(result.success).toBe(true);
  });

  it('should accept a payload with degraded set to true, when parsed', () => {
    const result = StatsResponseSchema.safeParse({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: true,
    });

    expect(result.success).toBe(true);
  });

  it('should accept a payload without degraded, when parsed', () => {
    const result = StatsResponseSchema.safeParse({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    });

    expect(result.success).toBe(true);
  });
});
