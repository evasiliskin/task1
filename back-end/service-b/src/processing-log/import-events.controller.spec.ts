import { type RmqContext } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type RabbitmqConfiguration } from '../config/rabbitmq.config.js';

import {
  DEAD_LETTERED_LOG,
  ImportEventsController,
  REPUBLISH_FAILED_LOG,
} from './import-events.controller.js';
import { type ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ImportEventsController', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';
  const rabbitmqConfiguration: RabbitmqConfiguration = {
    url: 'amqp://guest:guest@localhost:5672',
    queue: 'service_b_queue',
    prefetchCount: 10,
    maxRetries: 5,
    deadLetterQueue: 'service_b_queue.dlq',
    retryQueue: 'service_b_queue.retry',
    retryDelayMs: 5000,
  };

  afterEach(() => {
    rabbitmqConfiguration.maxRetries = 5;
  });

  interface ICapturedLogLine {
    fields: Record<string, unknown>;
    message: string;
    error?: unknown;
  }

  function buildController(upsertLog: ReturnType<typeof vi.fn>): {
    controller: ImportEventsController;
    errorLines: ICapturedLogLine[];
  } {
    const tracker = { upsertLog } as unknown as ProcessingLogTracker;
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
      requireContext: () => ({ correlationId, requestId: 'r', correlationIdSource: 'inbound' }),
    } as unknown as RequestContextService;

    return {
      controller: new ImportEventsController(
        tracker,
        rabbitmqConfiguration,
        requestContextService,
        loggerService,
      ),
      errorLines,
    };
  }

  function buildContext(headers: Record<string, unknown> = {}): {
    context: RmqContext;
    message: { content: Buffer; properties: { headers: Record<string, unknown> } };
    ack: ReturnType<typeof vi.fn>;
    nack: ReturnType<typeof vi.fn>;
    sendToQueue: ReturnType<typeof vi.fn>;
    assertQueue: ReturnType<typeof vi.fn>;
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

    return { context, message, ack, nack, sendToQueue, assertQueue };
  }

  describe('handleImportStarted', () => {
    const validPayload: ImportStartedEvent = {
      importId,
      archive,
      startedAt: '2026-08-11T00:00:00.000Z',
    };

    it('should upsert a started log entry and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const { controller } = buildController(upsertLog);
      const { context, message, ack, sendToQueue } = buildContext();

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
      expect(sendToQueue).not.toHaveBeenCalled();
    });

    it('should ack the message without upserting, when the payload fails validation', async () => {
      const upsertLog = vi.fn();
      const { controller } = buildController(upsertLog);
      const { context, message, ack } = buildContext();

      await controller.handleImportStarted({ importId: 'not-a-uuid' }, context);

      expect(upsertLog).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should republish to the retry queue with an incremented retry header and ack the original, when the repository write fails below maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const { controller } = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({
        'x-retry-count': 2,
      });

      await controller.handleImportStarted(validPayload, context);

      expect(assertQueue).toHaveBeenCalledWith('service_b_queue.retry', {
        durable: true,
        arguments: {
          'x-message-ttl': 5000,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'service_b_queue',
        },
      });
      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue.retry', message.content, {
        headers: { 'x-retry-count': 3 },
      });
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should publish to the retry queue rather than the working queue, when the log write fails below maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValueOnce(new Error('mongo down'));
      const { controller } = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext();

      await controller.handleImportStarted(validPayload, context);

      expect(assertQueue).toHaveBeenCalledWith('service_b_queue.retry', {
        durable: true,
        arguments: {
          'x-message-ttl': 5000,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'service_b_queue',
        },
      });
      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue.retry', message.content, {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        headers: expect.objectContaining({ 'x-retry-count': 1 }),
      });
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should nack-requeue the original and never ack it, when the retry publish is refused by channel backpressure', async () => {
      const upsertLog = vi.fn().mockRejectedValueOnce(new Error('mongo down'));
      const { controller } = buildController(upsertLog);
      const { context, message, ack, nack, sendToQueue } = buildContext();
      sendToQueue.mockReturnValue(false);

      await controller.handleImportStarted(validPayload, context);

      expect(nack).toHaveBeenCalledWith(message, false, true);
      expect(ack).not.toHaveBeenCalled();
    });

    it('should attach the underlying error to the dead-letter line, so the cause chain survives', async () => {
      const cause = new Error('connection reset by peer');
      const writeFailure = new Error('processing-log upsert failed', { cause });

      const upsertLog = vi.fn().mockRejectedValueOnce(writeFailure);
      const { controller, errorLines } = buildController(upsertLog);
      const { context, sendToQueue } = buildContext();
      sendToQueue.mockReturnValue(true);
      rabbitmqConfiguration.maxRetries = 0;

      await controller.handleImportStarted(validPayload, context);

      const line = errorLines.find((candidate) => candidate.message === DEAD_LETTERED_LOG);

      expect(line).toBeDefined();
      expect(line?.error).toBe(writeFailure);
      expect(line?.fields).not.toHaveProperty('reason');
    });

    it('should dead-letter the message and record a queryable dead-lettered log entry, when the repository write fails at maxRetries', async () => {
      const upsertLog = vi
        .fn()
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce(undefined);
      const { controller } = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({
        'x-retry-count': 5,
      });

      await controller.handleImportStarted(validPayload, context);

      expect(assertQueue).toHaveBeenCalledWith('service_b_queue.dlq', { durable: true });
      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue.dlq', message.content, {
        headers: { 'x-retry-count': 6 },
      });
      expect(upsertLog).toHaveBeenCalledTimes(2);
      expect(upsertLog).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          importId,
          status: 'dead-lettered',
          errorInfo: { reason: 'connection refused' },
        }),
      );
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should persist the String(...)-converted reason, when the retry is exhausted and the original write rejects with a non-Error value', async () => {
      const upsertLog = vi
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce(undefined);
      const { controller } = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({
        'x-retry-count': 5,
      });

      await controller.handleImportStarted(validPayload, context);

      expect(assertQueue).toHaveBeenCalledWith('service_b_queue.dlq', { durable: true });
      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue.dlq', message.content, {
        headers: { 'x-retry-count': 6 },
      });
      expect(upsertLog).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          importId,
          status: 'dead-lettered',
          // The controller does `String(reason)` on a non-Error rejection value; a plain object's
          // default stringification is always '[object Object]'.
          errorInfo: { reason: '[object Object]' },
        }),
      );
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should still ack the original message without throwing, when both the original write and the dead-letter log write fail', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const { controller } = buildController(upsertLog);
      const { context, message, ack } = buildContext({ 'x-retry-count': 5 });

      await expect(controller.handleImportStarted(validPayload, context)).resolves.toBeUndefined();
      expect(upsertLog).toHaveBeenCalledTimes(2);
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should nack-requeue the original message without acking, when republishing to the retry queue throws', async () => {
      const originalFailure = new Error('connection refused');
      const upsertLog = vi.fn().mockRejectedValue(originalFailure);
      const { controller, errorLines } = buildController(upsertLog);
      const { context, message, ack, nack, sendToQueue } = buildContext({ 'x-retry-count': 2 });
      sendToQueue.mockImplementation(() => {
        throw new Error('channel closed: PRECONDITION_FAILED');
      });

      await controller.handleImportStarted(validPayload, context);

      expect(nack).toHaveBeenCalledWith(message, false, true);
      expect(ack).not.toHaveBeenCalled();

      const line = errorLines.find((candidate) => candidate.message === REPUBLISH_FAILED_LOG);

      expect(line).toBeDefined();
      // The original write failure (why we were retrying) is the logged error, so it still
      // reaches the `err` serializer instead of being silently dropped.
      expect(line?.error).toBe(originalFailure);
      // The republish failure itself (a distinct, second error) must also be visible, so the
      // repeated nack-requeue loop is diagnosable instead of repeating an uninformative line.
      expect(line?.fields.republishError).toBe('channel closed: PRECONDITION_FAILED');
    });

    it('should nack-requeue the original message without acking, when asserting the dead-letter queue throws at maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const { controller } = buildController(upsertLog);
      const { context, message, ack, nack, assertQueue } = buildContext({ 'x-retry-count': 5 });
      assertQueue.mockRejectedValue(new Error('channel closed: PRECONDITION_FAILED'));

      await controller.handleImportStarted(validPayload, context);

      expect(nack).toHaveBeenCalledWith(message, false, true);
      expect(ack).not.toHaveBeenCalled();
    });

    it('should nack-requeue the original message without acking, when the upsert and republish failures are non-Error values', async () => {
      const upsertLog = vi.fn().mockRejectedValue('connection refused');
      const { controller, errorLines } = buildController(upsertLog);
      const { context, message, ack, nack, sendToQueue } = buildContext({ 'x-retry-count': 2 });
      sendToQueue.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error branch of the error-message formatting
        throw 'channel closed: PRECONDITION_FAILED';
      });

      await controller.handleImportStarted(validPayload, context);

      expect(nack).toHaveBeenCalledWith(message, false, true);
      expect(ack).not.toHaveBeenCalled();

      const line = errorLines.find((candidate) => candidate.message === REPUBLISH_FAILED_LOG);

      expect(line).toBeDefined();
      expect(line?.error).toBe('connection refused');
      expect(line?.fields.republishError).toBe('channel closed: PRECONDITION_FAILED');
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
