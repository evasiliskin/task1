import healthConfig from './health.config.js';

describe('healthConfig', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('should default the ping timeout to three seconds', () => {
    delete process.env.HEALTH_PING_TIMEOUT_MS;

    expect(healthConfig()).toEqual({ pingTimeoutMs: 3000 });
  });

  it('should read the ping timeout from the environment', () => {
    process.env.HEALTH_PING_TIMEOUT_MS = '750';

    expect(healthConfig()).toEqual({ pingTimeoutMs: 750 });
  });

  it('should reject a non-positive ping timeout', () => {
    process.env.HEALTH_PING_TIMEOUT_MS = '0';

    expect(() => healthConfig()).toThrow();
  });
});
