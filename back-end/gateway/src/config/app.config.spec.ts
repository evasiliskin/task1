import appConfig from './app.config';

describe('appConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults port to 3000 when PORT is not set', () => {
    delete process.env.PORT;

    expect(appConfig()).toEqual({ port: 3000 });
  });

  it('coerces PORT from a string to a number', () => {
    process.env.PORT = '8080';

    expect(appConfig()).toEqual({ port: 8080 });
  });

  it('throws when PORT is out of range', () => {
    process.env.PORT = '70000';

    expect(() => appConfig()).toThrow();
  });

  it('throws when PORT is not numeric', () => {
    process.env.PORT = 'not-a-number';

    expect(() => appConfig()).toThrow();
  });
});
