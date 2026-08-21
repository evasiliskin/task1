import uploadConfig from './upload.config.js';

describe('uploadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.UPLOAD_MAX_FILE_SIZE_BYTES;

      expect(uploadConfig()).toEqual({ maxFileSizeBytes: 536_870_912 });
    });
  });

  describe('environment overrides', () => {
    it('should coerce the value from the environment variable, when it is set', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '1000000';

      expect(uploadConfig()).toEqual({ maxFileSizeBytes: 1_000_000 });
    });
  });

  describe('validation', () => {
    it('should throw, when UPLOAD_MAX_FILE_SIZE_BYTES is zero', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '0';

      expect(() => uploadConfig()).toThrow();
    });

    it('should throw, when UPLOAD_MAX_FILE_SIZE_BYTES is not numeric', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = 'not-a-number';

      expect(() => uploadConfig()).toThrow();
    });
  });
});
