import { type AppLogger } from './app-logger';
import { NestLoggerBridge } from './nest-logger.bridge';

describe('NestLoggerBridge', () => {
  let appLogger: {
    trace: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let bridge: NestLoggerBridge;

  beforeEach(() => {
    appLogger = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    bridge = new NestLoggerBridge(appLogger as unknown as AppLogger);
  });

  it('should route log() to AppLogger.info()', () => {
    bridge.log('Nest application started', 'NestFactory');

    expect(appLogger.info).toHaveBeenCalledWith(
      { context: 'NestFactory' },
      'Nest application started',
    );
  });

  it('should route error() to AppLogger.error(), with the stack trace and context', () => {
    bridge.error('boom', 'stack trace here', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith(
      { context: 'SomeContext', trace: 'stack trace here' },
      'boom',
    );
  });

  it('should route warn() to AppLogger.warn()', () => {
    bridge.warn('careful', 'SomeContext');

    expect(appLogger.warn).toHaveBeenCalledWith({ context: 'SomeContext' }, 'careful');
  });

  it('should route debug() to AppLogger.debug()', () => {
    bridge.debug('debugging', 'SomeContext');

    expect(appLogger.debug).toHaveBeenCalledWith({ context: 'SomeContext' }, 'debugging');
  });

  it('should route verbose() to AppLogger.trace()', () => {
    bridge.verbose('verbose message', 'SomeContext');

    expect(appLogger.trace).toHaveBeenCalledWith({ context: 'SomeContext' }, 'verbose message');
  });

  it('should route fatal() to AppLogger.error(), with fatal: true', () => {
    bridge.fatal('fatal message', 'SomeContext');

    expect(appLogger.error).toHaveBeenCalledWith(
      { context: 'SomeContext', fatal: true },
      'fatal message',
    );
  });

  it('should not throw, when setLogLevels() is called', () => {
    expect(() => bridge.setLogLevels(['log', 'error'])).not.toThrow();
  });
});
