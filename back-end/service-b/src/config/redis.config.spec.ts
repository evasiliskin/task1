import redisConfig from './redis.config.js';

describe('redisConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.REDIS_URL;
      delete process.env.REDIS_METRICS_RETENTION_MS;

      expect(redisConfig()).toEqual({
        url: 'redis://localhost:6379',
        metricsRetentionMs: 604_800_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6379';
      process.env.REDIS_METRICS_RETENTION_MS = '3600000';

      expect(redisConfig()).toEqual({
        url: 'redis://redis-host:6379',
        metricsRetentionMs: 3_600_000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when REDIS_URL is not a valid url', () => {
      process.env.REDIS_URL = 'not-a-valid-url';

      expect(() => redisConfig()).toThrow();
    });

    it('should throw, when REDIS_METRICS_RETENTION_MS is not a positive number', () => {
      process.env.REDIS_METRICS_RETENTION_MS = '0';

      expect(() => redisConfig()).toThrow();
    });
  });
});
