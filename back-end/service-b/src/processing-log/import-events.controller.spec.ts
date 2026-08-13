import { type RmqContext } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';

import { type RabbitmqConfiguration } from '../config/rabbitmq.config.js';

import { ImportEventsController } from './import-events.controller.js';
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
  };

  function buildController(upsertLog: ReturnType<typeof vi.fn>): ImportEventsController {
    const tracker = { upsertLog } as unknown as ProcessingLogTracker;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: vi.fn(), error: vi.fn() }),
    } as unknown as LoggerService;

    return new ImportEventsController(tracker, rabbitmqConfiguration, loggerService);
  }

  function buildContext(headers: Record<string, unknown> = {}): {
    context: RmqContext;
    message: { content: Buffer; properties: { headers: Record<string, unknown> } };
    ack: ReturnType<typeof vi.fn>;
    sendToQueue: ReturnType<typeof vi.fn>;
    assertQueue: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('payload'), properties: { headers } };
    const ack = vi.fn();
    const sendToQueue = vi.fn();
    const assertQueue = vi.fn().mockResolvedValue(undefined);
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack, sendToQueue, assertQueue }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack, sendToQueue, assertQueue };
  }

  describe('handleImportStarted', () => {
    const validPayload: ImportStartedEvent = {
      importId,
      archive,
      startedAt: '2026-08-11T00:00:00.000Z',
      correlationId,
    };

    it('should upsert a started log entry and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const controller = buildController(upsertLog);
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
      const controller = buildController(upsertLog);
      const { context, message, ack } = buildContext();

      await controller.handleImportStarted({ importId: 'not-a-uuid' }, context);

      expect(upsertLog).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should republish to the same queue with an incremented retry header and ack the original, when the repository write fails below maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({
        'x-retry-count': 2,
      });

      await controller.handleImportStarted(validPayload, context);

      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue', message.content, {
        headers: { 'x-retry-count': 3 },
      });
      expect(assertQueue).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should dead-letter the message and ack the original, when the repository write fails at maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({
        'x-retry-count': 5,
      });

      await controller.handleImportStarted(validPayload, context);

      expect(assertQueue).toHaveBeenCalledWith('service_b_queue.dlq', { durable: true });
      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue.dlq', message.content, {
        headers: { 'x-retry-count': 6 },
      });
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should still ack the original message, when republishing to the retry queue throws', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue } = buildContext({ 'x-retry-count': 2 });
      sendToQueue.mockImplementation(() => {
        throw new Error('channel closed: PRECONDITION_FAILED');
      });

      await controller.handleImportStarted(validPayload, context);

      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should still ack the original message, when asserting the dead-letter queue throws at maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const controller = buildController(upsertLog);
      const { context, message, ack, assertQueue } = buildContext({ 'x-retry-count': 5 });
      assertQueue.mockRejectedValue(new Error('channel closed: PRECONDITION_FAILED'));

      await controller.handleImportStarted(validPayload, context);

      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should still ack the original message, when the upsert and republish failures are non-Error values', async () => {
      const upsertLog = vi.fn().mockRejectedValue('connection refused');
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue } = buildContext({ 'x-retry-count': 2 });
      sendToQueue.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error branch of the error-message formatting
        throw 'channel closed: PRECONDITION_FAILED';
      });

      await controller.handleImportStarted(validPayload, context);

      expect(ack).toHaveBeenCalledWith(message);
    });
  });

  describe('handleImportCompleted', () => {
    it('should upsert a completed log entry with the result counters as metadata and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const controller = buildController(upsertLog);
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
        correlationId,
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
      const controller = buildController(upsertLog);
      const { context, message, ack } = buildContext();
      const validPayload: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: 'download failed: 404 Not Found',
        correlationId,
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
