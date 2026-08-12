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

      expect(archiveConfig()).toEqual({
        baseUrl: 'https://data.gharchive.org',
        downloadTimeoutMs: 30_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.GITHUB_ARCHIVE_BASE_URL = 'https://custom-archive-mirror.example.com';
      process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS = '60000';

      expect(archiveConfig()).toEqual({
        baseUrl: 'https://custom-archive-mirror.example.com',
        downloadTimeoutMs: 60_000,
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
  });
});
