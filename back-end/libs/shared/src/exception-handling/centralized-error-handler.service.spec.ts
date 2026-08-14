import type { Mock } from 'vitest';

import { FatalError } from '../errors/index.js';
import { type AppLogger } from '../logger/app-logger.js';

import { CentralizedErrorHandlerService } from './centralized-error-handler.service.js';

describe('CentralizedErrorHandlerService', () => {
  let logger: { error: ReturnType<typeof vi.fn>; fatal: ReturnType<typeof vi.fn> };
  let service: CentralizedErrorHandlerService;
  let exitSpy: Mock<typeof process.exit>;

  beforeEach(() => {
    logger = { error: vi.fn(), fatal: vi.fn() };
    service = new CentralizedErrorHandlerService(logger as unknown as AppLogger);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe('when the error is not fatal', () => {
    it('should log name, message and stack at error level, when the error is an Error instance', () => {
      const error = new Error('boom');

      service.handleError(error);

      expect(logger.error).toHaveBeenCalledWith(
        { name: 'Error', message: 'boom', stack: error.stack },
        'boom',
      );
    });

    it('should log its stringified value, when the error is not an Error instance', () => {
      service.handleError('raw string failure');

      expect(logger.error).toHaveBeenCalledWith(
        { value: 'raw string failure' },
        'raw string failure',
      );
    });

    it('should not exit the process', () => {
      service.handleError(new Error('boom'));

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('when the error is a FatalError', () => {
    it('should log at fatal level and set a failing exit code without exiting synchronously', () => {
      vi.useFakeTimers();

      try {
        const error = new FatalError(new Error('boom'));

        service.handleError(error);

        expect(logger.fatal).toHaveBeenCalledWith(
          { name: error.name, message: error.message, stack: error.stack },
          `Fatal error: ${error.message}`,
        );
        expect(exitSpy).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should set a failing exit code and allow the runtime to drain rather than exiting synchronously', () => {
      vi.useFakeTimers();

      try {
        const handler = new CentralizedErrorHandlerService(logger as unknown as AppLogger);

        handler.handleError(new FatalError(new Error('boom')));

        expect(logger.fatal).toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should emit SIGTERM to trigger graceful shutdown hooks', () => {
      vi.useFakeTimers();
      const emitSpy = vi.spyOn(process, 'emit');

      try {
        service.handleError(new FatalError(new Error('boom')));

        expect(emitSpy).toHaveBeenCalledWith('SIGTERM');

        process.exitCode = 0;
      } finally {
        emitSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('should schedule an unref backstop that force-exits if shutdown hangs', () => {
      vi.useFakeTimers();

      try {
        service.handleError(new FatalError(new Error('boom')));

        expect(exitSpy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5000);

        expect(exitSpy).toHaveBeenCalledWith(1);

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
