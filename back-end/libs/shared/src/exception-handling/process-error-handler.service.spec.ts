import { type CentralizedErrorHandlerService } from './centralized-error-handler.service';
import { ProcessErrorHandlerService } from './process-error-handler.service';

describe('ProcessErrorHandlerService', () => {
  let centralizedErrorHandler: { handleFatalError: ReturnType<typeof vi.fn> };
  let service: ProcessErrorHandlerService;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    centralizedErrorHandler = { handleFatalError: vi.fn() };
    service = new ProcessErrorHandlerService(
      centralizedErrorHandler as unknown as CentralizedErrorHandlerService,
    );
    onSpy = vi.spyOn(process, 'on');
  });

  afterEach(() => {
    onSpy.mockRestore();
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  it('should register unhandledRejection and uncaughtException listeners, when the module initializes', () => {
    service.onModuleInit();

    expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
  });

  it('should rethrow the rejection reason, when unhandledRejection fires', () => {
    service.onModuleInit();

    const [, handler] = onSpy.mock.calls.find(([event]) => event === 'unhandledRejection') ?? [];
    const reason = new Error('unhandled');

    expect(() => (handler as (reason: unknown) => void)(reason)).toThrow(reason);
  });

  it('should delegate to CentralizedErrorHandlerService, when uncaughtException fires', () => {
    service.onModuleInit();

    const [, handler] = onSpy.mock.calls.find(([event]) => event === 'uncaughtException') ?? [];
    const error = new Error('uncaught');

    (handler as (error: unknown) => void)(error);

    expect(centralizedErrorHandler.handleFatalError).toHaveBeenCalledWith(error);
  });
});
