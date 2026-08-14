import loggerConfig from './logger.config.js';

describe('loggerConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Every case below is about some other variable; the ones that are about SERVICE_NAME itself
    // override this explicitly.
    process.env.SERVICE_NAME = 'api-gateway';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should default to "trace" level, when LOG_LEVEL is unset and NODE_ENV is not "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';

      expect(loggerConfig().level).toBe('trace');
    });

    it('should default to "info" level, when LOG_LEVEL is unset and NODE_ENV is "production"', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';

      expect(loggerConfig().level).toBe('info');
    });

    it('should default to the "json" transport, when APP_LOG_TRANSPORT is unset', () => {
      delete process.env.APP_LOG_TRANSPORT;

      expect(loggerConfig().transport).toBe('json');
    });

    it('should fall back to "unknown-service", when SERVICE_NAME is unset outside production', () => {
      delete process.env.SERVICE_NAME;
      process.env.NODE_ENV = 'development';

      expect(loggerConfig().serviceName).toBe('unknown-service');
    });
  });

  describe('environment overrides', () => {
    it('should use an explicit LOG_LEVEL, even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'warn';

      expect(loggerConfig().level).toBe('warn');
    });

    it('should select the pretty transport, when APP_LOG_TRANSPORT is "pretty"', () => {
      process.env.APP_LOG_TRANSPORT = 'pretty';

      expect(loggerConfig().transport).toBe('pretty');
    });

    it('should select the json transport, when APP_LOG_TRANSPORT is any other value', () => {
      process.env.APP_LOG_TRANSPORT = 'anything-else';

      expect(loggerConfig().transport).toBe('json');
    });

    it('should use an explicit SERVICE_NAME, when it is set', () => {
      process.env.SERVICE_NAME = 'api-gateway';

      expect(loggerConfig().serviceName).toBe('api-gateway');
    });
  });

  describe('validation', () => {
    it('should throw, when LOG_LEVEL is not one of the documented levels', () => {
      process.env.LOG_LEVEL = 'verbose';

      expect(() => loggerConfig()).toThrow();
    });

    it('should throw, when SERVICE_NAME is unset in production', () => {
      delete process.env.SERVICE_NAME;
      process.env.NODE_ENV = 'production';

      expect(() => loggerConfig()).toThrow('SERVICE_NAME');
    });
  });
});
