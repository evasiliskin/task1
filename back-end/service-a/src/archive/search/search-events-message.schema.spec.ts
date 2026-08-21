import { searchEventsMessageSchema } from './search-events-message.schema.js';

describe('searchEventsMessageSchema', () => {
  it('should default limit to 50, when limit is omitted', () => {
    expect(searchEventsMessageSchema.parse({}).limit).toBe(50);
  });

  it('should accept every optional filter field, when all are present and well-formed', () => {
    const message = {
      type: 'PushEvent',
      repository: 'octocat/hello-world',
      actor: 'octocat',
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      cursor: 'some-cursor',
      limit: 25,
    };

    expect(searchEventsMessageSchema.parse(message)).toEqual(message);
  });

  it('should coerce a numeric-string limit, when it arrives as a string over the wire', () => {
    expect(searchEventsMessageSchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('should throw, when limit exceeds 200', () => {
    expect(() => searchEventsMessageSchema.parse({ limit: 201 })).toThrow();
  });

  it('should throw, when limit is zero or negative', () => {
    expect(() => searchEventsMessageSchema.parse({ limit: 0 })).toThrow();
  });

  it('should throw, when from is not an ISO datetime string', () => {
    expect(() => searchEventsMessageSchema.parse({ from: 'not-a-date' })).toThrow();
  });

  it('should throw, when type is an empty string', () => {
    expect(() => searchEventsMessageSchema.parse({ type: '' })).toThrow();
  });

  it('should throw, when importId is not a valid UUID', () => {
    expect(() => searchEventsMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });
});
