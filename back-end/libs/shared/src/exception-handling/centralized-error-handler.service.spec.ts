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

    it('should not exit the process, when the error is not fatal', () => {
      service.handleError(new Error('boom'));

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('when the error is a FatalError', () => {
    it('should log at fatal level and set a failing exit code, when a FatalError is handled', () => {
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

    it('should let the runtime drain instead of exiting synchronously, when a FatalError is handled', () => {
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

    it('should emit SIGTERM, when a FatalError triggers graceful shutdown', () => {
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

    it('should schedule an unref force-exit backstop, when a FatalError is handled', () => {
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

    it('should route the error through the err serializer, when a FatalError is handled', () => {
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

    it('should stamp the request context onto the fatal line, when one is supplied', () => {
      vi.useFakeTimers();

      try {
        service.handleError(new FatalError(new Error('boom')), {
          correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        });

        expect(logger.fatal.mock.calls[0][0]).toMatchObject({
          correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        });

        process.exitCode = 0;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should flush the buffered destination before the forced-exit backstop, when a FatalError is handled', () => {
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

  it('should receive the pino destination through DI, when resolved from the module', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [loggerConfig] }),
        RequestContextModule,
        ExceptionHandlingModule,
      ],
    }).compile();

    const resolved = moduleFixture.get(CentralizedErrorHandlerService);

    expect(Reflect.get(resolved, 'destination')).toBeDefined();

    await moduleFixture.close();
  });
});
