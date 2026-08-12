import { importCompletedEventSchema } from './import-completed.event.js';

describe('importCompletedEventSchema', () => {
  const validPayload = {
    importId: '11111111-1111-4111-8111-111111111111',
    archive: '2026-08-11-0.json.gz',
    startedAt: '2026-08-11T00:00:00.000Z',
    completedAt: '2026-08-11T00:05:00.000Z',
    eventsProcessed: 1000,
    validEvents: 990,
    invalidEvents: 5,
    duplicateEvents: 5,
    errorCount: 0,
    correlationId: 'c1',
  };

  it('should accept a valid payload, when all fields are present and well-formed', () => {
    expect(importCompletedEventSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('should coerce numeric-string counters, when they arrive as strings over the wire', () => {
    const result = importCompletedEventSchema.parse({ ...validPayload, eventsProcessed: '1000' });

    expect(result.eventsProcessed).toBe(1000);
  });

  it('should throw, when eventsProcessed is negative', () => {
    expect(() =>
      importCompletedEventSchema.parse({ ...validPayload, eventsProcessed: -1 }),
    ).toThrow();
  });

  it('should throw, when completedAt is not an ISO datetime string', () => {
    expect(() =>
      importCompletedEventSchema.parse({ ...validPayload, completedAt: 'not-a-date' }),
    ).toThrow();
  });
});
