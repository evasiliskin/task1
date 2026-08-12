import { AppLogger } from './app-logger';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    fatal: ReturnType<typeof vi.fn>;
  };
  let logger: AppLogger;

  beforeEach(() => {
    pinoLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };
    logger = new AppLogger(pinoLogger, 'HealthController', 'http');
  });

  it('should forward info() to the underlying pino logger with source and channel bound', () => {
    logger.info({ statusCode: 200 }, 'request handled');

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { statusCode: 200, source: 'HealthController', channel: 'http' },
      'request handled',
    );
  });

  it('should forward trace()', () => {
    logger.trace({}, 'trace message');

    expect(pinoLogger.trace).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'http' },
      'trace message',
    );
  });

  it('should forward debug()', () => {
    logger.debug({}, 'debug message');

    expect(pinoLogger.debug).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'http' },
      'debug message',
    );
  });

  it('should forward warn()', () => {
    logger.warn({}, 'warn message');

    expect(pinoLogger.warn).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'http' },
      'warn message',
    );
  });

  it('should forward error()', () => {
    logger.error({}, 'error message');

    expect(pinoLogger.error).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'http' },
      'error message',
    );
  });

  it('should forward fatal()', () => {
    logger.fatal({}, 'fatal message');

    expect(pinoLogger.fatal).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'http' },
      'fatal message',
    );
  });
});
