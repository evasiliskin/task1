import mongodbConfig from './mongodb.config.js';

describe('mongodbConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGO_BATCH_SIZE;
      delete process.env.MONGO_INSERT_CONCURRENCY;

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://localhost:27017/service_a',
        batchSize: 500,
        insertConcurrency: 2,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo-host:27017/custom-db';
      process.env.MONGO_BATCH_SIZE = '250';
      process.env.MONGO_INSERT_CONCURRENCY = '4';

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://user:pass@mongo-host:27017/custom-db',
        batchSize: 250,
        insertConcurrency: 4,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when MONGODB_URI is not a valid url', () => {
      process.env.MONGODB_URI = 'not-a-valid-url';

      expect(() => mongodbConfig()).toThrow();
    });

    it('should throw, when MONGO_BATCH_SIZE is not a positive number', () => {
      process.env.MONGO_BATCH_SIZE = '0';

      expect(() => mongodbConfig()).toThrow();
    });

    it('should throw, when MONGO_INSERT_CONCURRENCY exceeds the safe ceiling', () => {
      process.env.MONGO_INSERT_CONCURRENCY = '99';

      expect(() => mongodbConfig()).toThrow();
    });
  });
});
