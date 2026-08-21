import reportConfig from './report.config.js';

describe('reportConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented defaults, when no environment variable is set', () => {
      delete process.env.REPORT_DIR;
      delete process.env.REPORT_RETENTION_MS;
      delete process.env.REPORT_SWEEP_INTERVAL_MS;

      expect(reportConfig()).toEqual({
        dir: './data/reports',
        retentionMs: 3_600_000,
        sweepIntervalMs: 600_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse the values from the environment variables, when they are set', () => {
      process.env.REPORT_DIR = '/data/reports';
      process.env.REPORT_RETENTION_MS = '7200000';
      process.env.REPORT_SWEEP_INTERVAL_MS = '300000';

      expect(reportConfig()).toEqual({
        dir: '/data/reports',
        retentionMs: 7_200_000,
        sweepIntervalMs: 300_000,
      });
    });
  });

  describe('validation', () => {
    it('should fall back to the documented default, when REPORT_DIR is an empty string outside production', () => {
      process.env.NODE_ENV = 'development';
      process.env.REPORT_DIR = '';

      expect(reportConfig().dir).toBe('./data/reports');
    });

    it('should throw, when REPORT_DIR is unset in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REPORT_DIR;

      expect(() => reportConfig()).toThrow(/REPORT_DIR/);
    });

    it('should throw, when REPORT_RETENTION_MS is not a positive number', () => {
      process.env.REPORT_RETENTION_MS = '0';

      expect(() => reportConfig()).toThrow();
    });

    it('should throw, when REPORT_SWEEP_INTERVAL_MS is not a positive number', () => {
      process.env.REPORT_SWEEP_INTERVAL_MS = '0';

      expect(() => reportConfig()).toThrow();
    });
  });
});
