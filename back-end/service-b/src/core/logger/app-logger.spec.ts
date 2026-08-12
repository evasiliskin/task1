import { type Logger } from 'pino';

import { AppLogger } from './app-logger';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let logger: AppLogger;

  beforeEach(() => {
    pinoLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger = new AppLogger(pinoLogger as unknown as Logger, 'HealthController', 'rmq');
  });

  it('should forward info() to the underlying pino logger with source and channel bound', () => {
    logger.info({ pattern: 'health.check' }, 'message handled');

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { pattern: 'health.check', source: 'HealthController', channel: 'rmq' },
      'message handled',
    );
  });

  it('should forward trace()', () => {
    logger.trace({}, 'trace message');

    expect(pinoLogger.trace).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'rmq' },
      'trace message',
    );
  });

  it('should forward debug()', () => {
    logger.debug({}, 'debug message');

    expect(pinoLogger.debug).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'rmq' },
      'debug message',
    );
  });

  it('should forward warn()', () => {
    logger.warn({}, 'warn message');

    expect(pinoLogger.warn).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'rmq' },
      'warn message',
    );
  });

  it('should forward error()', () => {
    logger.error({}, 'error message');

    expect(pinoLogger.error).toHaveBeenCalledWith(
      { source: 'HealthController', channel: 'rmq' },
      'error message',
    );
  });
});
