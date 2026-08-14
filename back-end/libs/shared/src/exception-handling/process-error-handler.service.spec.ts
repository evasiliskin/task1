import type { Mock } from 'vitest';

import { FatalError } from '../errors/index.js';

import { type CentralizedErrorHandlerService } from './centralized-error-handler.service.js';
import { ProcessErrorHandlerService } from './process-error-handler.service.js';

describe('ProcessErrorHandlerService', () => {
  let centralizedErrorHandler: { handleError: ReturnType<typeof vi.fn> };
  let service: ProcessErrorHandlerService;
  let onSpy: Mock<typeof process.on>;

  beforeEach(() => {
    centralizedErrorHandler = { handleError: vi.fn() };
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

    expect(centralizedErrorHandler.handleError).toHaveBeenCalledWith(new FatalError(error));
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
