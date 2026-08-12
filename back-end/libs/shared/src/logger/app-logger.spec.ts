import type { Mock } from 'vitest';

import { AppLogger, type IPinoLikeLogger } from './app-logger.js';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: Mock<IPinoLikeLogger['trace']>;
    debug: Mock<IPinoLikeLogger['debug']>;
    info: Mock<IPinoLikeLogger['info']>;
    warn: Mock<IPinoLikeLogger['warn']>;
    error: Mock<IPinoLikeLogger['error']>;
    fatal: Mock<IPinoLikeLogger['fatal']>;
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
