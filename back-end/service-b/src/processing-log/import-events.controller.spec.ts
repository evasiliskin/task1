import { type RmqContext } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';
import { type RequestContextService } from '@task1/shared/request-context/request-context.service';

import {
  DEAD_LETTER_RECORD_FAILED_LOG,
  ImportEventsController,
  MALFORMED_MESSAGE_LOG,
} from './import-events.controller.js';
import { type ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ImportEventsController', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';

  interface ICapturedLogLine {
    fields: Record<string, unknown>;
    message: string;
    error?: unknown;
  }

  function buildController(
    upsertLog: ReturnType<typeof vi.fn>,
    settleFailure: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue('retried'),
  ): {
    controller: ImportEventsController;
    errorLines: ICapturedLogLine[];
    settleFailure: ReturnType<typeof vi.fn>;
  } {
    const tracker = { upsertLog } as unknown as ProcessingLogTracker;
    const retryPublisher = { settleFailure } as unknown as RetryPublisher;
    const errorLines: ICapturedLogLine[] = [];
    const logger = {
      info: () => undefined,
      warn: (fields: Record<string, unknown>, message: string, error?: unknown) =>
        errorLines.push({ fields, message, error }),
      error: (fields: Record<string, unknown>, message: string, error?: unknown) =>
        errorLines.push({ fields, message, error }),
    };
    const loggerService = {
      getLogger: vi.fn().mockReturnValue(logger),
    } as unknown as LoggerService;
    const requestContextService = {
      requireContext: () => ({
        correlationId,
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      }),
    } as unknown as RequestContextService;

    return {
      controller: new ImportEventsController(
        tracker,
        retryPublisher,
        requestContextService,
        loggerService,
      ),
      errorLines,
      settleFailure,
    };
  }

  function buildContext(headers: Record<string, unknown> = {}): {
    context: RmqContext;
    message: { content: Buffer; properties: { headers: Record<string, unknown> } };
    ack: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('payload'), properties: { headers } };
    const ack = vi.fn();
    const nack = vi.fn();
    const sendToQueue = vi.fn().mockReturnValue(true);
    const assertQueue = vi.fn().mockResolvedValue(undefined);
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack, nack, sendToQueue, assertQueue }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack };
  }

  describe('handleImportStarted', () => {
    const validPayload: ImportStartedEvent = {
      importId,
      archive,
      startedAt: '2026-08-11T00:00:00.000Z',
    };

    it('should upsert a started log entry and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const { controller, settleFailure } = buildController(upsertLog);
      const { context, message, ack } = buildContext();

      await controller.handleImportStarted(validPayload, context);

      const expectedEntry: IProcessingLogDocument = {
        importId,
        eventType: EVENT_PATTERNS.IMPORT_STARTED,
        service: 'service-a',
        status: 'started',
        timestamp: new Date(validPayload.startedAt),
        correlationId,
        archive,
        metadata: {},
      };

      expect(upsertLog).toHaveBeenCalledWith(expectedEntry);
      expect(ack).toHaveBeenCalledWith(message);
      expect(settleFailure).not.toHaveBeenCalled();
    });

    it('should ack the message without upserting, when the payload fails validation', async () => {
      const upsertLog = vi.fn();
      const { controller, errorLines } = buildController(upsertLog);
      const { context, message, ack } = buildContext();

      await controller.handleImportStarted({ importId: 'not-a-uuid' }, context);

      expect(upsertLog).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(message);
      expect(errorLines.some((line) => line.message === MALFORMED_MESSAGE_LOG)).toBe(true);
    });

    it('should delegate the delivery outcome to RetryPublisher.settleFailure, when the repository write fails', async () => {
      const writeFailure = new Error('connection refused');
      const upsertLog = vi.fn().mockRejectedValueOnce(writeFailure);
      const settleFailure = vi.fn().mockResolvedValue('retried');
      const { controller } = buildController(upsertLog, settleFailure);
      const { context, message } = buildContext({ 'x-retry-count': 2 });

      await controller.handleImportStarted(validPayload, context);

      expect(settleFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(Function) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
          ack: expect.any(Function),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(Function) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
          nack: expect.any(Function),
        }),
        message,
        writeFailure,
      );
    });

    it('should not record a dead-letter processing-log entry, when RetryPublisher reports "retried"', async () => {
      const upsertLog = vi.fn().mockRejectedValueOnce(new Error('mongo down'));
      const settleFailure = vi.fn().mockResolvedValue('retried');
      const { controller } = buildController(upsertLog, settleFailure);
      const { context } = buildContext();

      await controller.handleImportStarted(validPayload, context);

      expect(upsertLog).toHaveBeenCalledTimes(1);
    });

    it('should record a queryable dead-lettered log entry, when RetryPublisher reports "rejected"', async () => {
      const writeFailure = new Error('connection refused');
      const upsertLog = vi
        .fn()
        .mockRejectedValueOnce(writeFailure)
        .mockResolvedValueOnce(undefined);
      const settleFailure = vi.fn().mockResolvedValue('rejected');
      const { controller } = buildController(upsertLog, settleFailure);
      const { context } = buildContext();

      await controller.handleImportStarted(validPayload, context);

      expect(upsertLog).toHaveBeenCalledTimes(2);
    });

    it('should record a queryable dead-lettered log entry, when RetryPublisher reports "dead-lettered"', async () => {
      const writeFailure = new Error('connection refused');
      const upsertLog = vi
        .fn()
        .mockRejectedValueOnce(writeFailure)
        .mockResolvedValueOnce(undefined);
      const settleFailure = vi.fn().mockResolvedValue('dead-lettered');
      const { controller } = buildController(upsertLog, settleFailure);
      const { context } = buildContext({ 'x-retry-count': 5 });

      await controller.handleImportStarted(validPayload, context);

      expect(upsertLog).toHaveBeenCalledTimes(2);
      expect(upsertLog).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          importId,
          status: 'dead-lettered',
          errorInfo: { reason: 'connection refused' },
        }),
      );
    });

    it('should persist the String(...)-converted reason, when the retry is exhausted and the original write rejects with a non-Error value', async () => {
      const upsertLog = vi
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce(undefined);
      const settleFailure = vi.fn().mockResolvedValue('dead-lettered');
      const { controller } = buildController(upsertLog, settleFailure);
      const { context } = buildContext({ 'x-retry-count': 5 });

      await controller.handleImportStarted(validPayload, context);

      expect(upsertLog).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          importId,
          status: 'dead-lettered',
          errorInfo: { reason: '[object Object]' },
        }),
      );
    });

    it('should not throw, when both the original write and the dead-letter log write fail', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const settleFailure = vi.fn().mockResolvedValue('dead-lettered');
      const { controller, errorLines } = buildController(upsertLog, settleFailure);
      const { context } = buildContext({ 'x-retry-count': 5 });

      await expect(controller.handleImportStarted(validPayload, context)).resolves.toBeUndefined();
      expect(upsertLog).toHaveBeenCalledTimes(2);
      expect(errorLines.some((line) => line.message === DEAD_LETTER_RECORD_FAILED_LOG)).toBe(true);
    });
  });

  describe('handleImportCompleted', () => {
    it('should upsert a completed log entry with the result counters as metadata and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const { controller } = buildController(upsertLog);
      const { context, message, ack } = buildContext();
      const validPayload: ImportCompletedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        completedAt: '2026-08-11T00:05:00.000Z',
        eventsProcessed: 10,
        validEvents: 8,
        invalidEvents: 1,
        duplicateEvents: 1,
        errorCount: 0,
      };

      await controller.handleImportCompleted(validPayload, context);

      expect(upsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          metadata: {
            eventsProcessed: 10,
            validEvents: 8,
            invalidEvents: 1,
            duplicateEvents: 1,
            errorCount: 0,
          },
        }),
      );
      expect(ack).toHaveBeenCalledWith(message);
    });
  });

  describe('handleImportFailed', () => {
    it('should upsert a failed log entry with errorInfo and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const { controller } = buildController(upsertLog);
      const { context, message, ack } = buildContext();
      const validPayload: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: 'download failed: 404 Not Found',
      };

      await controller.handleImportFailed(validPayload, context);

      expect(upsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorInfo: { reason: 'download failed: 404 Not Found' },
        }),
      );
      expect(ack).toHaveBeenCalledWith(message);
    });
  });
});
