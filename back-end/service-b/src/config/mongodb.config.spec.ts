import mongodbConfig from './mongodb.config.js';

describe('mongodbConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.MONGODB_URI;

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://localhost:27017/service_b',
        processingLogRetentionMs: 2_592_000_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo-host:27017/custom-db';

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://user:pass@mongo-host:27017/custom-db',
        processingLogRetentionMs: 2_592_000_000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when MONGODB_URI is not a valid url', () => {
      process.env.MONGODB_URI = 'not-a-valid-url';

      expect(() => mongodbConfig()).toThrow();
    });
  });
});
