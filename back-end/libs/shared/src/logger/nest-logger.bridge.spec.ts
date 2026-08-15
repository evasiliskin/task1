import { Writable } from 'node:stream';

import { type LogLevel } from '@nestjs/common';
import { pino } from 'pino';

import { AppLogger } from './app-logger.js';
import { NestLoggerBridge } from './nest-logger.bridge.js';

function buildBridge(): { bridge: NestLoggerBridge; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  const root = pino({ level: 'trace' }, stream);
  const bridge = new NestLoggerBridge(AppLogger.create(root, 'Nest', 'http'));

  return { bridge, lines };
}

describe('NestLoggerBridge', () => {
  let appLogger: {
    trace: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    fatal: ReturnType<typeof vi.fn>;
  };
  let bridge: NestLoggerBridge;

  beforeEach(() => {
    appLogger = {
      trace: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    };
    bridge = new NestLoggerBridge(appLogger as unknown as AppLogger);
  });

  it('should route log() to AppLogger.info()', () => {
    bridge.log('Nest application started', 'NestFactory');

    expect(appLogger.info).toHaveBeenCalledWith(
      { nestContext: 'NestFactory' },
      'Nest application started',
    );
  });

  it('should route error() to AppLogger.error(), with the stack and nestContext', () => {
    bridge.error('boom', 'stack trace here', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith(
      { nestContext: 'SomeContext', stack: 'stack trace here' },
      'boom',
    );
  });

  it('should route warn() to AppLogger.warn()', () => {
    bridge.warn('careful', 'SomeContext');

    expect(appLogger.warn).toHaveBeenCalledWith({ nestContext: 'SomeContext' }, 'careful');
  });

  it('should route debug() to AppLogger.debug()', () => {
    bridge.debug('debugging', 'SomeContext');

    expect(appLogger.debug).toHaveBeenCalledWith({ nestContext: 'SomeContext' }, 'debugging');
  });

  it('should route verbose() to AppLogger.trace()', () => {
    bridge.verbose('verbose message', 'SomeContext');

    expect(appLogger.trace).toHaveBeenCalledWith({ nestContext: 'SomeContext' }, 'verbose message');
  });

  it('should route fatal() to AppLogger.fatal(), so it lands on pino level 60', () => {
    bridge.fatal('fatal message', 'SomeContext');

    expect(appLogger.fatal).toHaveBeenCalledWith({ nestContext: 'SomeContext' }, 'fatal message');
    expect(appLogger.error).not.toHaveBeenCalled();
  });

  it("should name Nest's context field nestContext, not context", () => {
    const { bridge: realBridge, lines } = buildBridge();

    realBridge.log('Mapped {/health, GET} route', 'RouterExplorer');

    expect(lines[0]).toMatchObject({ source: 'Nest', nestContext: 'RouterExplorer' });
    expect(lines[0]).not.toHaveProperty('context');
  });

  it('should name the stack field stack, not trace', () => {
    const { bridge: realBridge, lines } = buildBridge();
    const stack = 'Error: boom\n    at handler (app.ts:1:1)';

    realBridge.error('boom', stack, 'ExceptionsHandler');

    expect(lines[0]).toMatchObject({ stack, nestContext: 'ExceptionsHandler' });
    expect(lines[0]).not.toHaveProperty('trace');
  });

  it('should not throw, when setLogLevels() is called', () => {
    expect(() => bridge.setLogLevels(['log', 'error'])).not.toThrow();
  });

  it('should leave the pino level unchanged, when none of the requested levels map to a known pino level', () => {
    const pinoLogger = pino({ level: 'info' });
    const bridgeWithPino = new NestLoggerBridge(
      AppLogger.create(pinoLogger, 'Nest', 'http'),
      pinoLogger,
    );

    bridgeWithPino.setLogLevels(['unknown-level'] as unknown as LogLevel[]);

    expect(pinoLogger.level).toBe('info');
  });

  it('should apply the highest requested level to the underlying pino logger', () => {
    const pinoLogger = pino({ level: 'info' });
    const bridgeWithPino = new NestLoggerBridge(
      AppLogger.create(pinoLogger, 'Nest', 'http'),
      pinoLogger,
    );

    bridgeWithPino.setLogLevels(['warn', 'error']);

    expect(pinoLogger.level).toBe('warn');
  });
});
