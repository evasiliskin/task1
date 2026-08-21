import { SearchLogsResponseSchema } from './search-logs-response.schema.js';

describe('SearchLogsResponseSchema', () => {
  it('should accept a payload with one entry and no errorInfo, when parsed', () => {
    const result = SearchLogsResponseSchema.safeParse({
      items: [
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          eventType: 'github.import.completed',
          service: 'service-a',
          status: 'completed',
          timestamp: '2026-08-11T00:05:00.000Z',
          correlationId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          archive: '2026-08-11-0.json.gz',
          metadata: { eventsProcessed: 10, validEvents: 8 },
        },
      ],
      pagination: { nextCursor: 'some-cursor' },
    });

    expect(result.success).toBe(true);
  });

  it('should accept an entry with errorInfo, when parsed', () => {
    const result = SearchLogsResponseSchema.safeParse({
      items: [
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          eventType: 'github.import.failed',
          service: 'service-a',
          status: 'failed',
          timestamp: '2026-08-11T00:05:00.000Z',
          correlationId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          archive: '2026-08-11-0.json.gz',
          metadata: {},
          errorInfo: { reason: 'download failed: 404 Not Found' },
        },
      ],
      pagination: {},
    });

    expect(result.success).toBe(true);
  });
});
