import { getNodeEnv, isProduction } from './environment.helper';

describe('environment.helper', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isProduction', () => {
    it('should return true, when NODE_ENV is "production"', () => {
      process.env.NODE_ENV = 'production';

      expect(isProduction()).toBe(true);
    });

    it('should return false, when NODE_ENV is not "production"', () => {
      process.env.NODE_ENV = 'development';

      expect(isProduction()).toBe(false);
    });
  });

  describe('getNodeEnv', () => {
    it('should return the value of NODE_ENV, when set', () => {
      process.env.NODE_ENV = 'staging';

      expect(getNodeEnv()).toBe('staging');
    });

    it('should default to "development", when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;

      expect(getNodeEnv()).toBe('development');
    });
  });
});
