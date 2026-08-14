import reportConfig from './report.config.js';

describe('reportConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.REPORT_DIR;

      expect(reportConfig()).toEqual({ dir: './data/reports' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.REPORT_DIR = '/data/reports';

      expect(reportConfig()).toEqual({ dir: '/data/reports' });
    });
  });

  describe('validation', () => {
    it('should throw, when REPORT_DIR is an empty string', () => {
      process.env.REPORT_DIR = '';

      expect(() => reportConfig()).toThrow();
    });
  });
});
