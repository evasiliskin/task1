import { importFailedEventSchema } from './import-failed.event.js';

describe('importFailedEventSchema', () => {
  const validPayload = {
    importId: '11111111-1111-4111-8111-111111111111',
    archive: '2026-08-11-0.json.gz',
    startedAt: '2026-08-11T00:00:00.000Z',
    failedAt: '2026-08-11T00:02:00.000Z',
    reason: 'download failed: 404 Not Found',
    correlationId: 'c1',
  };

  it('should accept a valid payload, when all fields are present and well-formed', () => {
    expect(importFailedEventSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('should throw, when reason is an empty string', () => {
    expect(() => importFailedEventSchema.parse({ ...validPayload, reason: '' })).toThrow();
  });

  it('should throw, when failedAt is not an ISO datetime string', () => {
    expect(() =>
      importFailedEventSchema.parse({ ...validPayload, failedAt: 'not-a-date' }),
    ).toThrow();
  });
});
