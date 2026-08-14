import storageConfig from './storage.config.js';

describe('storageConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.STORAGE_DIR;

      expect(storageConfig()).toEqual({ dir: './data/archives' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.STORAGE_DIR = '/data/archives';

      expect(storageConfig()).toEqual({ dir: '/data/archives' });
    });
  });

  describe('validation', () => {
    it('should throw, when STORAGE_DIR is an empty string', () => {
      process.env.STORAGE_DIR = '';

      expect(() => storageConfig()).toThrow();
    });
  });
});
