import archiveConfig from './archive.config.js';

describe('archiveConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.GITHUB_ARCHIVE_BASE_URL;
      delete process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS;
      delete process.env.ARCHIVE_DOWNLOAD_TOTAL_TIMEOUT_MS;
      delete process.env.ARCHIVE_DOWNLOAD_MAX_ATTEMPTS;
      delete process.env.ARCHIVE_DOWNLOAD_RETRY_DELAY_MS;

      expect(archiveConfig()).toEqual({
        baseUrl: 'https://data.gharchive.org',
        downloadTimeoutMs: 30_000,
        downloadTotalTimeoutMs: 600_000,
        downloadMaxAttempts: 3,
        downloadRetryDelayMs: 2000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.GITHUB_ARCHIVE_BASE_URL = 'https://custom-archive-mirror.example.com';
      process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS = '60000';
      process.env.ARCHIVE_DOWNLOAD_TOTAL_TIMEOUT_MS = '900000';
      process.env.ARCHIVE_DOWNLOAD_MAX_ATTEMPTS = '5';
      process.env.ARCHIVE_DOWNLOAD_RETRY_DELAY_MS = '3000';

      expect(archiveConfig()).toEqual({
        baseUrl: 'https://custom-archive-mirror.example.com',
        downloadTimeoutMs: 60_000,
        downloadTotalTimeoutMs: 900_000,
        downloadMaxAttempts: 5,
        downloadRetryDelayMs: 3000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when GITHUB_ARCHIVE_BASE_URL is not a valid url', () => {
      process.env.GITHUB_ARCHIVE_BASE_URL = 'not-a-valid-url';

      expect(() => archiveConfig()).toThrow();
    });

    it('should throw, when ARCHIVE_DOWNLOAD_TIMEOUT_MS is not a positive number', () => {
      process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS = '0';

      expect(() => archiveConfig()).toThrow();
    });

    it('should throw, when ARCHIVE_DOWNLOAD_TOTAL_TIMEOUT_MS is not a positive number', () => {
      process.env.ARCHIVE_DOWNLOAD_TOTAL_TIMEOUT_MS = '0';

      expect(() => archiveConfig()).toThrow();
    });

    it('should throw, when ARCHIVE_DOWNLOAD_MAX_ATTEMPTS is not a positive number', () => {
      process.env.ARCHIVE_DOWNLOAD_MAX_ATTEMPTS = '0';

      expect(() => archiveConfig()).toThrow();
    });

    it('should throw, when ARCHIVE_DOWNLOAD_RETRY_DELAY_MS is not a positive number', () => {
      process.env.ARCHIVE_DOWNLOAD_RETRY_DELAY_MS = '0';

      expect(() => archiveConfig()).toThrow();
    });
  });
});
