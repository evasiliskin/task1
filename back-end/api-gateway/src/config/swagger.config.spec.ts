import swaggerConfig from './swagger.config.js';

describe('swaggerConfig', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('should enable the documentation, when NODE_ENV is not production and the flag is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SWAGGER_ENABLED;

    expect(swaggerConfig().enabled).toBe(true);
  });

  it('should disable the documentation, when NODE_ENV is production and the flag is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SWAGGER_ENABLED;

    expect(swaggerConfig().enabled).toBe(false);
  });

  it('should enable the documentation, when the flag is the string "true" in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';

    expect(swaggerConfig().enabled).toBe(true);
  });

  it('should disable the documentation, when the flag is the string "false" outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.SWAGGER_ENABLED = 'false';

    expect(swaggerConfig().enabled).toBe(false);
  });

  it('should disable the documentation, when the flag holds any other value', () => {
    process.env.NODE_ENV = 'development';
    process.env.SWAGGER_ENABLED = 'yes';

    expect(swaggerConfig().enabled).toBe(false);
  });
});
