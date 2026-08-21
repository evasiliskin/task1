import type { Mock } from 'vitest';

import { FatalError } from '../errors/index.js';
import { RequestContextService } from '../request-context/request-context.service.js';

import { type CentralizedErrorHandlerService } from './centralized-error-handler.service.js';
import { ProcessErrorHandlerService } from './process-error-handler.service.js';

describe('ProcessErrorHandlerService', () => {
  let centralizedErrorHandler: { handleError: ReturnType<typeof vi.fn> };
  let requestContextService: RequestContextService;
  let service: ProcessErrorHandlerService;
  let onSpy: Mock<typeof process.on>;

  beforeEach(() => {
    centralizedErrorHandler = { handleError: vi.fn() };
    requestContextService = new RequestContextService();
    service = new ProcessErrorHandlerService(
      centralizedErrorHandler as unknown as CentralizedErrorHandlerService,
      requestContextService,
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

    expect(centralizedErrorHandler.handleError).toHaveBeenCalledWith(new FatalError(error), {});
  });

  it('should carry the raising request context into the fatal handler, when unhandledRejection fires', () => {
    const handler = new ProcessErrorHandlerService(
      centralizedErrorHandler as unknown as CentralizedErrorHandlerService,
      requestContextService,
    );

    handler.onModuleInit();

    const rejection = new Error('mongo write timed out');

    requestContextService.run(
      {
        correlationId: '5c3a9d18-2e74-4f61-8b05-9a7d2c6e4f83',
        requestId: 'b17f4d82-3c50-4a69-9e13-7d8a2c05f469',
        correlationIdSource: 'inbound',
      },
      () => {
        expect(() => process.emit('unhandledRejection', rejection, Promise.resolve())).toThrow(
          rejection,
        );
      },
    );

    process.emit('uncaughtException', rejection);

    expect(centralizedErrorHandler.handleError).toHaveBeenCalledWith(
      expect.any(FatalError),
      expect.objectContaining({ correlationId: '5c3a9d18-2e74-4f61-8b05-9a7d2c6e4f83' }),
    );

    handler.onModuleDestroy();
  });

  it('should remove the registered listeners, when the module is destroyed', () => {
    const unhandledRejectionCountBefore = process.listenerCount('unhandledRejection');
    const uncaughtExceptionCountBefore = process.listenerCount('uncaughtException');

    service.onModuleInit();
    service.onModuleDestroy();

    expect(process.listenerCount('unhandledRejection')).toBe(unhandledRejectionCountBefore);
    expect(process.listenerCount('uncaughtException')).toBe(uncaughtExceptionCountBefore);
  });
});
