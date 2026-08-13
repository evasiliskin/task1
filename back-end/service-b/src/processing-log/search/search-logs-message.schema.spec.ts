import { searchLogsMessageSchema } from './search-logs-message.schema.js';

describe('searchLogsMessageSchema', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('should default limit to 50, when limit is omitted', () => {
    expect(searchLogsMessageSchema.parse({}).limit).toBe(50);
  });

  it('should accept every optional filter field, when all are present and well-formed', () => {
    const message = {
      importId,
      status: 'completed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      cursor: 'some-cursor',
      limit: 25,
    };

    expect(searchLogsMessageSchema.parse(message)).toEqual(message);
  });

  it('should coerce a numeric-string limit, when it arrives as a string over the wire', () => {
    expect(searchLogsMessageSchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('should throw, when limit exceeds 200', () => {
    expect(() => searchLogsMessageSchema.parse({ limit: 201 })).toThrow();
  });

  it('should throw, when limit is zero or negative', () => {
    expect(() => searchLogsMessageSchema.parse({ limit: 0 })).toThrow();
  });

  it('should throw, when importId is not a uuid', () => {
    expect(() => searchLogsMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });

  it('should throw, when status is not a known processing status', () => {
    expect(() => searchLogsMessageSchema.parse({ status: 'unknown' })).toThrow();
  });

  it('should throw, when from is not an ISO datetime string', () => {
    expect(() => searchLogsMessageSchema.parse({ from: 'not-a-date' })).toThrow();
  });
});
