import { type AppLogger } from '../logger/app-logger';

import { CentralizedErrorHandlerService } from './centralized-error-handler.service';

describe('CentralizedErrorHandlerService', () => {
  let logger: { fatal: ReturnType<typeof vi.fn> };
  let service: CentralizedErrorHandlerService;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = { fatal: vi.fn() };
    service = new CentralizedErrorHandlerService(logger as unknown as AppLogger);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('should log name, message and stack, when the error is an Error instance', () => {
    const error = new Error('boom');

    service.handleFatalError(error);

    expect(logger.fatal).toHaveBeenCalledWith(
      { name: 'Error', message: 'boom', stack: error.stack },
      'Fatal error: boom',
    );
  });

  it('should log its stringified value, when the error is not an Error instance', () => {
    service.handleFatalError('raw string failure');

    expect(logger.fatal).toHaveBeenCalledWith(
      { value: 'raw string failure' },
      'Fatal error: raw string failure',
    );
  });

  it('should exit the process with code 1, after logging', () => {
    service.handleFatalError(new Error('boom'));

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
