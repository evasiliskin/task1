import mongodbConfig from './mongodb.config.js';

describe('mongodbConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_PING_TIMEOUT_MS;

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://localhost:27017/gateway',
        pingTimeoutMs: 3000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo-host:27017/custom-db';
      process.env.MONGODB_PING_TIMEOUT_MS = '5000';

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://user:pass@mongo-host:27017/custom-db',
        pingTimeoutMs: 5000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when MONGODB_URI is not a valid url', () => {
      process.env.MONGODB_URI = 'not-a-valid-url';

      expect(() => mongodbConfig()).toThrow();
    });

    it('should throw, when MONGODB_PING_TIMEOUT_MS is not a positive number', () => {
      process.env.MONGODB_PING_TIMEOUT_MS = '-1';

      expect(() => mongodbConfig()).toThrow();
    });
  });
});
