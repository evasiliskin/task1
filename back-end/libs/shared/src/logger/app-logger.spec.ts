import type { Mock } from 'vitest';

import { AppLogger, type IAppLogger } from './app-logger.js';

describe('AppLogger', () => {
  let pinoLogger: {
    trace: Mock<IAppLogger['trace']>;
    debug: Mock<IAppLogger['debug']>;
    info: Mock<IAppLogger['info']>;
    warn: Mock<IAppLogger['warn']>;
    error: Mock<IAppLogger['error']>;
    fatal: Mock<IAppLogger['fatal']>;
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

  it('should include a normalized error field on warn(), when a real Error is passed as the third argument', () => {
    logger.warn({ key: 'x' }, 'warn message', new Error('boom'));

    expect(pinoLogger.warn).toHaveBeenCalledWith(
      {
        key: 'x',
        error: 'boom',
        stack: expect.stringContaining('Error: boom') as string,
        source: 'HealthController',
        channel: 'http',
      },
      'warn message',
    );
  });

  it('should stringify a non-Error value passed as the third argument to warn()', () => {
    logger.warn({}, 'warn message', 'not an Error instance');

    expect(pinoLogger.warn).toHaveBeenCalledWith(
      { error: 'not an Error instance', source: 'HealthController', channel: 'http' },
      'warn message',
    );
  });

  it('should include a normalized error field on error()', () => {
    logger.error({ pattern: 'x.y' }, 'error message', new Error('kaboom'));

    expect(pinoLogger.error).toHaveBeenCalledWith(
      {
        pattern: 'x.y',
        error: 'kaboom',
        stack: expect.stringContaining('Error: kaboom') as string,
        source: 'HealthController',
        channel: 'http',
      },
      'error message',
    );
  });

  it('should include a normalized error field on fatal()', () => {
    logger.fatal({}, 'fatal message', new Error('fatal boom'));

    expect(pinoLogger.fatal).toHaveBeenCalledWith(
      {
        error: 'fatal boom',
        stack: expect.stringContaining('Error: fatal boom') as string,
        source: 'HealthController',
        channel: 'http',
      },
      'fatal message',
    );
  });

  it('should omit the stack field, when the third argument is not an Error', () => {
    logger.error({}, 'error message', 'not an Error instance');

    expect(pinoLogger.error).toHaveBeenCalledWith(
      { error: 'not an Error instance', source: 'HealthController', channel: 'http' },
      'error message',
    );
  });

  it('should not add an error field, when the third argument is omitted (backward compatible)', () => {
    logger.warn({ key: 'x' }, 'warn message');

    expect(pinoLogger.warn).toHaveBeenCalledWith(
      { key: 'x', source: 'HealthController', channel: 'http' },
      'warn message',
    );
  });
});
