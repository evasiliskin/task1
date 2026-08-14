import { importStatusMessageSchema } from './import-status-message.schema.js';

describe('importStatusMessageSchema', () => {
  it('should parse successfully, when importId is a valid UUID', () => {
    const result = importStatusMessageSchema.parse({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });

    expect(result.importId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });

  it('should throw, when importId is not a valid UUID', () => {
    expect(() => importStatusMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });

  it('should throw, when importId is missing', () => {
    expect(() => importStatusMessageSchema.parse({})).toThrow();
  });
});
