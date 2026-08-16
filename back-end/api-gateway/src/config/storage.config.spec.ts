import storageConfig from './storage.config.js';

describe('storageConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.STORAGE_DIR;

      expect(storageConfig()).toEqual({
        dir: './data/archives',
        uploadRetentionMs: 86_400_000,
        uploadSweepIntervalMs: 900_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.STORAGE_DIR = '/data/archives';

      expect(storageConfig()).toEqual({
        dir: '/data/archives',
        uploadRetentionMs: 86_400_000,
        uploadSweepIntervalMs: 900_000,
      });
    });
  });

  describe('validation', () => {
    it('should fall back to the documented default, when STORAGE_DIR is an empty string outside production', () => {
      process.env.NODE_ENV = 'development';
      process.env.STORAGE_DIR = '';

      expect(storageConfig()).toEqual({
        dir: './data/archives',
        uploadRetentionMs: 86_400_000,
        uploadSweepIntervalMs: 900_000,
      });
    });

    it('should throw, when STORAGE_DIR is unset in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.STORAGE_DIR;

      expect(() => storageConfig()).toThrow(/STORAGE_DIR/);
    });

    it('should throw, when UPLOAD_RETENTION_MS is below the 10-minute retry-envelope floor', () => {
      process.env.UPLOAD_RETENTION_MS = '600000';

      expect(() => storageConfig()).not.toThrow();

      process.env.UPLOAD_RETENTION_MS = '599999';

      expect(() => storageConfig()).toThrow();
    });
  });
});
