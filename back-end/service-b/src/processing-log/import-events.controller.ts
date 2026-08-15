import { Controller, Inject } from '@nestjs/common';
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
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type ZodType } from 'zod';

import rabbitmqConfig, { type RabbitmqConfiguration } from '../config/rabbitmq.config.js';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';
import { buildRetryHeaders, getRetryCount, type IRmqMessage } from './retry-count.util.js';
import { buildRetryQueueArguments } from './retry-queue.util.js';
import {
  toCompletedLogEntry,
  toFailedLogEntry,
  toStartedLogEntry,
} from './to-processing-log-entry.js';

interface IRmqChannel {
  ack(message: IRmqMessage): void;
  nack(message: IRmqMessage, allUpTo: boolean, requeue: boolean): void;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: { headers?: Record<string, unknown> },
  ): boolean;
  assertQueue(
    queue: string,
    options?: { durable?: boolean; arguments?: Record<string, unknown> },
  ): Promise<unknown>;
}

export const MALFORMED_MESSAGE_LOG = 'Rejected malformed import event, acking without storing';
export const RETRY_SCHEDULED_LOG =
  'Processing-log write failed, republishing with an incremented retry count';
export const DEAD_LETTERED_LOG =
  'Processing-log write failed at maxRetries, moving message to the dead-letter queue';
export const DEAD_LETTER_RECORD_FAILED_LOG =
  'Failed to record the dead-lettered event as a processing-log entry';
export const REPUBLISH_FAILED_LOG =
  'Retry/dead-letter republish failed, acking the original message to release the prefetch slot';
export const REPUBLISH_REFUSED_LOG =
  'Retry/dead-letter publish refused by channel backpressure, requeueing the original message';
const DEAD_LETTER_REASON_MAX_LENGTH = 500;

@Controller()
export class ImportEventsController {
  public constructor(
    private readonly tracker: ProcessingLogTracker,
    @Inject(rabbitmqConfig.KEY) private readonly rabbitmqConfiguration: RabbitmqConfiguration,
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
      channel.ack(message);
    } catch (error) {
      await this.retryOrDeadLetter(channel, message, eventType, entry, error);
    }
  }

  private async retryOrDeadLetter(
    channel: IRmqChannel,
    message: IRmqMessage,
    eventType: string,
    entry: IProcessingLogDocument,
    error: unknown,
  ): Promise<void> {
    const retryCount = getRetryCount(message) + 1;
    const headers = buildRetryHeaders(message, retryCount);
    const isExhausted = retryCount > this.rabbitmqConfiguration.maxRetries;

    let accepted: boolean;

    try {
      accepted = isExhausted
        ? await this.publishDeadLetter(channel, message, headers)
        : await this.publishRetry(channel, message, headers);
    } catch (republishError) {
      this.logger.error(
        {
          eventType,
          retryCount,
          republishError:
            republishError instanceof Error ? republishError.message : String(republishError),
        },
        REPUBLISH_FAILED_LOG,
        error,
      );

      channel.nack(message, false, true);

      return;
    }

    if (!accepted) {
      this.logger.error({ eventType, retryCount }, REPUBLISH_REFUSED_LOG, error);
      channel.nack(message, false, true);

      return;
    }

    if (isExhausted) {
      this.logger.error({ eventType, retryCount }, DEAD_LETTERED_LOG, error);
      await this.recordDeadLetter(
        entry,
        eventType,
        error instanceof Error ? error.message : String(error),
      );
    } else {
      this.logger.warn({ eventType, retryCount }, RETRY_SCHEDULED_LOG, error);
    }

    channel.ack(message);
  }

  private async publishRetry(
    channel: IRmqChannel,
    message: IRmqMessage,
    headers: Record<string, unknown>,
  ): Promise<boolean> {
    const { retryQueue, retryDelayMs, queue } = this.rabbitmqConfiguration;

    await channel.assertQueue(retryQueue, {
      durable: true,
      arguments: buildRetryQueueArguments(queue, retryDelayMs),
    });

    return channel.sendToQueue(retryQueue, message.content, { headers });
  }

  private async publishDeadLetter(
    channel: IRmqChannel,
    message: IRmqMessage,
    headers: Record<string, unknown>,
  ): Promise<boolean> {
    await channel.assertQueue(this.rabbitmqConfiguration.deadLetterQueue, { durable: true });

    return channel.sendToQueue(this.rabbitmqConfiguration.deadLetterQueue, message.content, {
      headers,
    });
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
