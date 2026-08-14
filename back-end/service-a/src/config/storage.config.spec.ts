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
    it('should fall back to the documented default, when STORAGE_DIR is an empty string outside production', () => {
      process.env.NODE_ENV = 'development';
      process.env.STORAGE_DIR = '';

      expect(storageConfig()).toEqual({ dir: './data/archives' });
    });

    it('should throw, when STORAGE_DIR is unset in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.STORAGE_DIR;

      expect(() => storageConfig()).toThrow(/STORAGE_DIR/);
    });
  });
});
