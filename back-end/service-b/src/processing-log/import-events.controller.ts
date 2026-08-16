import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  importCompletedEventSchema,
  importFailedEventSchema,
  importStartedEventSchema,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RetryPublisher } from '@task1/shared/messaging/retry-publisher';
import { type IRmqChannel, type IRmqMessage } from '@task1/shared/messaging/rmq-channel.types';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type ZodType } from 'zod';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';
import {
  toCompletedLogEntry,
  toFailedLogEntry,
  toStartedLogEntry,
} from './to-processing-log-entry.js';

export const MALFORMED_MESSAGE_LOG = 'Rejected malformed import event, acking without storing';
export const DEAD_LETTER_RECORD_FAILED_LOG =
  'Failed to record the dead-lettered event as a processing-log entry';
const DEAD_LETTER_REASON_MAX_LENGTH = 500;

/**
 * Retry/DLQ delivery outcomes are owned by `RetryPublisher` (`@task1/shared/messaging`) — this
 * controller only maps payloads to processing-log entries and, once the delivery outcome comes
 * back as `dead-lettered` (exhausted retries) or `rejected` (republish itself failed, nacked
 * straight to the DLQ), records that outcome as a queryable log entry.
 */
@Controller()
export class ImportEventsController {
  public constructor(
    private readonly tracker: ProcessingLogTracker,
    private readonly retryPublisher: RetryPublisher,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ImportEventsController.name);
  }

  @EventPattern(EVENT_PATTERNS.IMPORT_STARTED)
  public handleImportStarted(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    return this.processEvent(
      EVENT_PATTERNS.IMPORT_STARTED,
      importStartedEventSchema,
      toStartedLogEntry,
      payload,
      context,
    );
  }

  @EventPattern(EVENT_PATTERNS.IMPORT_COMPLETED)
  public handleImportCompleted(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    return this.processEvent(
      EVENT_PATTERNS.IMPORT_COMPLETED,
      importCompletedEventSchema,
      toCompletedLogEntry,
      payload,
      context,
    );
  }

  @EventPattern(EVENT_PATTERNS.IMPORT_FAILED)
  public handleImportFailed(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    return this.processEvent(
      EVENT_PATTERNS.IMPORT_FAILED,
      importFailedEventSchema,
      toFailedLogEntry,
      payload,
      context,
    );
  }

  private readonly logger: AppLogger;

  private async processEvent<
    TEvent extends ImportStartedEvent | ImportCompletedEvent | ImportFailedEvent,
  >(
    eventType: string,
    schema: ZodType<TEvent>,
    toEntry: (event: TEvent, eventType: string, correlationId: string) => IProcessingLogDocument,
    payload: unknown,
    context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as IRmqChannel;
    const message = context.getMessage() as IRmqMessage;

    const parseResult = schema.safeParse(payload);

    if (!parseResult.success) {
      this.logger.warn({ eventType }, MALFORMED_MESSAGE_LOG, parseResult.error);
      channel.ack(message);

      return;
    }

    const entry = toEntry(
      parseResult.data,
      eventType,
      this.requestContextService.requireContext().correlationId,
    );

    try {
      await this.tracker.upsertLog(entry);
      ackMessage(context);
    } catch (error) {
      await this.handleWriteFailure(channel, message, eventType, entry, error);
    }
  }

  private async handleWriteFailure(
    channel: IRmqChannel,
    message: IRmqMessage,
    eventType: string,
    entry: IProcessingLogDocument,
    error: unknown,
  ): Promise<void> {
    const outcome = await this.retryPublisher.settleFailure(channel, message, error);

    if (outcome === 'dead-lettered' || outcome === 'rejected') {
      await this.recordDeadLetter(
        entry,
        eventType,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async recordDeadLetter(
    entry: IProcessingLogDocument,
    eventType: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.tracker.upsertLog({
        ...entry,
        status: 'dead-lettered',
        errorInfo: { reason: reason.slice(0, DEAD_LETTER_REASON_MAX_LENGTH) },
      });
    } catch (writeError) {
      this.logger.error({ eventType }, DEAD_LETTER_RECORD_FAILED_LOG, writeError);
    }
  }
}
