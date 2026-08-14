import throttleConfig from './throttle.config.js';

describe('throttleConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented defaults, when no environment variables are set', () => {
      delete process.env.THROTTLE_TTL_MS;
      delete process.env.THROTTLE_LIMIT;
      delete process.env.THROTTLE_UPLOAD_LIMIT;

      expect(throttleConfig()).toEqual({ ttlMs: 60_000, limit: 100, uploadLimit: 5 });
    });
  });

  describe('environment overrides', () => {
    it('should coerce the values from the environment variables, when they are set', () => {
      process.env.THROTTLE_TTL_MS = '30000';
      process.env.THROTTLE_LIMIT = '50';
      process.env.THROTTLE_UPLOAD_LIMIT = '2';

      expect(throttleConfig()).toEqual({ ttlMs: 30_000, limit: 50, uploadLimit: 2 });
    });
  });

  describe('validation', () => {
    it('should throw, when THROTTLE_TTL_MS is zero', () => {
      process.env.THROTTLE_TTL_MS = '0';

      expect(() => throttleConfig()).toThrow();
    });

    it('should throw, when THROTTLE_LIMIT is not numeric', () => {
      process.env.THROTTLE_LIMIT = 'not-a-number';

      expect(() => throttleConfig()).toThrow();
    });

    it('should throw, when THROTTLE_UPLOAD_LIMIT is negative', () => {
      process.env.THROTTLE_UPLOAD_LIMIT = '-1';

      expect(() => throttleConfig()).toThrow();
    });
  });
});
