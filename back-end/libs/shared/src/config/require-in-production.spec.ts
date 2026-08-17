import { requireInProduction } from './require-in-production.js';

describe('requireInProduction', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return the value unchanged, when one is provided', () => {
    expect(requireInProduction(process.env.X ?? 'set', 'X', 'fallback')).toBe('set');
  });

  it('should fall back to the supplied default, when not running in production', () => {
    process.env.NODE_ENV = 'development';

    expect(requireInProduction(undefined, 'MONGODB_URI', 'mongodb://localhost:27017/x')).toBe(
      'mongodb://localhost:27017/x',
    );
  });

  it('should throw, when the value is missing in production', () => {
    process.env.NODE_ENV = 'production';

    expect(() =>
      requireInProduction(undefined, 'MONGODB_URI', 'mongodb://localhost:27017/x'),
    ).toThrow(/MONGODB_URI/);
  });
});
