import { getStatsMessageSchema } from './get-stats-message.schema.js';

describe('getStatsMessageSchema', () => {
  it('should parse successfully with importId undefined, when no importId is provided', () => {
    expect(getStatsMessageSchema.parse({})).toEqual({ importId: undefined });
  });

  it('should parse successfully, when importId is a valid uuid', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(getStatsMessageSchema.parse({ importId })).toEqual({ importId });
  });

  it('should throw, when importId is not a uuid', () => {
    expect(() => getStatsMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });
});
