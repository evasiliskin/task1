import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest';

import loggerConfig from '../config/logger.config.js';
import { FatalError } from '../errors/index.js';
import { type AppLogger } from '../logger/app-logger.js';
import { type IFlushableDestination } from '../logger/pino-destination.factory.js';
import { RequestContextModule } from '../request-context/rmq/request-context.module.js';

import { CentralizedErrorHandlerService } from './centralized-error-handler.service.js';
import { ExceptionHandlingModule } from './rmq/exception-handling.module.js';

describe('CentralizedErrorHandlerService', () => {
  let logger: { error: ReturnType<typeof vi.fn>; fatal: ReturnType<typeof vi.fn> };
  let destination: { write: ReturnType<typeof vi.fn>; flushSync: ReturnType<typeof vi.fn> };
  let service: CentralizedErrorHandlerService;
  let exitSpy: Mock<typeof process.exit>;

  beforeEach(() => {
    logger = { error: vi.fn(), fatal: vi.fn() };
    destination = { write: vi.fn(), flushSync: vi.fn() };
    service = new CentralizedErrorHandlerService(
      logger as unknown as AppLogger,
      destination as unknown as IFlushableDestination,
    );
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(process, 'emit').mockImplementation((() => true) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('when the error is not fatal', () => {
    it('should pass the error via the third argument at error level, when the error is an Error instance', () => {
      const error = new Error('boom');

      service.handleError(error);

      expect(logger.error).toHaveBeenCalledWith({}, 'boom', error);
    });

    it('should log its stringified value, when the error is not an Error instance', () => {
      service.handleError('raw string failure');

      expect(logger.error).toHaveBeenCalledWith({}, 'raw string failure', 'raw string failure');
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

        expect(logger.fatal).toHaveBeenCalledWith({}, `Fatal error: ${error.message}`, error);
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

    it('should route the error through the err serializer rather than flattening it', () => {
      vi.useFakeTimers();

      try {
        const cause = new Error('ECONNREFUSED 10.0.0.5:27017');
        const error = new FatalError(cause);

        service.handleError(error);

        expect(logger.fatal).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Fatal error'),
          error,
        );
        expect(logger.fatal.mock.calls[0][0]).not.toHaveProperty('stack');

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should stamp the supplied request context onto the fatal line', () => {
      vi.useFakeTimers();

      try {
        service.handleError(new FatalError(new Error('boom')), {
          correlationId: 'c-1',
          requestId: 'r-1',
          correlationIdSource: 'inbound',
        });

        expect(logger.fatal.mock.calls[0][0]).toMatchObject({
          correlationId: 'c-1',
          requestId: 'r-1',
        });

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should flush the buffered destination before the forced-exit backstop', () => {
      vi.useFakeTimers();

      try {
        service.handleError(new FatalError(new Error('boom')));

        expect(destination.flushSync).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5000);

        expect(destination.flushSync).toHaveBeenCalledTimes(2);

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('should receive the pino destination through DI, not silently undefined', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [loggerConfig] }),
        RequestContextModule,
        ExceptionHandlingModule,
      ],
    }).compile();

    const resolved = moduleFixture.get(CentralizedErrorHandlerService);

    // The private field is the thing under test: `@Optional()` hides a wiring mistake otherwise.
    expect(Reflect.get(resolved, 'destination')).toBeDefined();

    await moduleFixture.close();
  });
});
