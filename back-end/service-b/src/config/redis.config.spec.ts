import redisConfig from './redis.config.js';

describe('redisConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.REDIS_URL;

      expect(redisConfig()).toEqual({ url: 'redis://localhost:6379' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6379';

      expect(redisConfig()).toEqual({ url: 'redis://redis-host:6379' });
    });
  });

  describe('validation', () => {
    it('should throw, when REDIS_URL is not a valid url', () => {
      process.env.REDIS_URL = 'not-a-valid-url';

      expect(() => redisConfig()).toThrow();
    });
  });
});
