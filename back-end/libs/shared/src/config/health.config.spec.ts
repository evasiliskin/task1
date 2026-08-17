import healthConfig from './health.config.js';

describe('healthConfig', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('should default the ping timeout to three seconds, when the environment does not set it', () => {
    delete process.env.HEALTH_PING_TIMEOUT_MS;

    expect(healthConfig()).toEqual({ pingTimeoutMs: 3000 });
  });

  it('should read the ping timeout, when the environment sets it', () => {
    process.env.HEALTH_PING_TIMEOUT_MS = '750';

    expect(healthConfig()).toEqual({ pingTimeoutMs: 750 });
  });

  it('should throw, when the ping timeout is not positive', () => {
    process.env.HEALTH_PING_TIMEOUT_MS = '0';

    expect(() => healthConfig()).toThrow();
  });
});
