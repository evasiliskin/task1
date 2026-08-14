import { type AppLogger } from './app-logger.js';
import { type ILoggerFactory, LoggerAware } from './logger-aware.base.js';

function factoryStub(): { factory: ILoggerFactory; getLogger: ReturnType<typeof vi.fn> } {
  const logger = { info: vi.fn() } as unknown as AppLogger;
  const getLogger = vi.fn().mockReturnValue(logger);

  return { factory: { getLogger }, getLogger };
}

describe('LoggerAware', () => {
  it('should name the logger after the concrete subclass, when constructed', () => {
    const { factory, getLogger } = factoryStub();

    class ImportOrchestrationService extends LoggerAware {
      public constructor(loggerFactory: ILoggerFactory) {
        super(loggerFactory);
      }
    }

    // eslint-disable-next-line no-new -- the constructor's side effect on the factory is what is under test
    new ImportOrchestrationService(factory);

    expect(getLogger).toHaveBeenCalledWith('ImportOrchestrationService');
  });

  it('should name the logger after the most-derived subclass, when the hierarchy is deeper than one level', () => {
    const { factory, getLogger } = factoryStub();

    class BaseController extends LoggerAware {
      public constructor(loggerFactory: ILoggerFactory) {
        super(loggerFactory);
      }
    }

    class UploadImportController extends BaseController {}

    // eslint-disable-next-line no-new -- see above
    new UploadImportController(factory);

    expect(getLogger).toHaveBeenCalledWith('UploadImportController');
  });

  it('should expose the resolved logger to subclasses, when constructed', () => {
    const { factory } = factoryStub();

    class StatsService extends LoggerAware {
      public constructor(loggerFactory: ILoggerFactory) {
        super(loggerFactory);
      }

      public log(): void {
        this.logger.info({}, 'ready');
      }
    }

    const service = new StatsService(factory);

    expect(() => {
      service.log();
    }).not.toThrow();
  });
});
