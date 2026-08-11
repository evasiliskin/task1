import appConfig from './app.config';

describe('appConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('port', () => {
    it('should default port to 3000, when PORT is not set', () => {
      delete process.env.PORT;

      expect(appConfig()).toEqual({ port: 3000 });
    });

    it('should coerce PORT from a string to a number, when PORT is a numeric string', () => {
      process.env.PORT = '8080';

      expect(appConfig()).toEqual({ port: 8080 });
    });

    it('should accept the minimum valid port, when PORT is 1', () => {
      process.env.PORT = '1';

      expect(appConfig()).toEqual({ port: 1 });
    });

    it('should accept the maximum valid port, when PORT is 65535', () => {
      process.env.PORT = '65535';

      expect(appConfig()).toEqual({ port: 65535 });
    });

    it('should throw, when PORT exceeds the maximum valid value', () => {
      process.env.PORT = '70000';

      expect(() => appConfig()).toThrow();
    });

    it('should throw, when PORT is below the minimum valid value', () => {
      process.env.PORT = '0';

      expect(() => appConfig()).toThrow();
    });

    it('should throw, when PORT is not numeric', () => {
      process.env.PORT = 'not-a-number';

      expect(() => appConfig()).toThrow();
    });
  });
});
