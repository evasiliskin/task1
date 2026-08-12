import { importStartedEventSchema } from './import-started.event.js';

describe('importStartedEventSchema', () => {
  const validPayload = {
    importId: '11111111-1111-4111-8111-111111111111',
    archive: '2026-08-11-0.json.gz',
    startedAt: '2026-08-11T00:00:00.000Z',
    correlationId: 'c1',
  };

  it('should accept a valid payload, when all fields are present and well-formed', () => {
    expect(importStartedEventSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('should throw, when importId is not a UUID', () => {
    expect(() =>
      importStartedEventSchema.parse({ ...validPayload, importId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('should throw, when archive is an empty string', () => {
    expect(() => importStartedEventSchema.parse({ ...validPayload, archive: '' })).toThrow();
  });

  it('should throw, when startedAt is not an ISO datetime string', () => {
    expect(() =>
      importStartedEventSchema.parse({ ...validPayload, startedAt: 'not-a-date' }),
    ).toThrow();
  });

  it('should throw, when correlationId is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { correlationId, ...withoutCorrelationId } = validPayload;

    expect(() => importStartedEventSchema.parse(withoutCorrelationId)).toThrow();
  });
});
