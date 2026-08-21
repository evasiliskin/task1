import { Inject, Injectable } from '@nestjs/common';

import { type AppLogger } from '../logger/app-logger.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';
import { LOGGER_FACTORY } from '../logger/logger.tokens.js';

import { publishConfirmed } from './confirm-publish.js';
import { QUEUE_TOPOLOGY, RETRY_POLICY } from './messaging.tokens.js';
import { type IQueueTopology } from './queue-topology.js';
import { computeRetryDelayMs } from './retry-delay.util.js';
import { buildRetryHeaders, getRetryCount } from './retry-headers.util.js';
import { type IRmqChannel, type IRmqMessage } from './rmq-channel.types.js';

export type RetryOutcome = 'retried' | 'dead-lettered' | 'rejected';

export interface IRetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  publishConfirmTimeoutMs: number;
}

export const RETRY_SCHEDULED_LOG = 'handler failed, republishing with an incremented retry count';
export const DEAD_LETTERED_LOG =
  'handler failed at maxRetries, moving message to the dead-letter queue';
export const REPUBLISH_FAILED_LOG =
  'retry/dead-letter republish failed, dead-lettering the original message';

@Injectable()
export class RetryPublisher {
  public constructor(
    @Inject(QUEUE_TOPOLOGY) private readonly topology: IQueueTopology,
    @Inject(RETRY_POLICY) private readonly policy: IRetryPolicy,
    @Inject(LOGGER_FACTORY) loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.getLogger(RetryPublisher.name);
  }

  public async settleFailure(
    channel: IRmqChannel,
    message: IRmqMessage,
    error: unknown,
  ): Promise<RetryOutcome> {
    const attempt = getRetryCount(message) + 1;
    const isExhausted = attempt > this.policy.maxRetries;

    try {
      await (isExhausted
        ? this.publishDeadLetter(message, attempt, channel)
        : this.publishRetry(message, attempt, channel));
    } catch (republishError) {
      this.logger.error({ attempt }, REPUBLISH_FAILED_LOG, republishError);

      return this.rejectToDeadLetterExchange(channel, message, attempt, error);
    }

    if (isExhausted) {
      this.logger.error({ attempt }, DEAD_LETTERED_LOG, error);
    } else {
      this.logger.warn({ attempt }, RETRY_SCHEDULED_LOG, error);
    }

    channel.ack(message);

    return isExhausted ? 'dead-lettered' : 'retried';
  }

  private readonly logger: AppLogger;

  private async publishRetry(
    message: IRmqMessage,
    attempt: number,
    channel: IRmqChannel,
  ): Promise<void> {
    const delayMs = computeRetryDelayMs(
      attempt,
      this.policy.retryDelayMs,
      this.policy.maxRetryDelayMs,
    );

    await publishConfirmed({
      channel,
      queue: this.topology.retry,
      content: message.content,
      headers: buildRetryHeaders(message, attempt),
      timeoutMs: this.policy.publishConfirmTimeoutMs,
      expiration: String(delayMs),
    });
  }

  private async publishDeadLetter(
    message: IRmqMessage,
    attempt: number,
    channel: IRmqChannel,
  ): Promise<void> {
    await publishConfirmed({
      channel,
      queue: this.topology.deadLetter,
      content: message.content,
      headers: buildRetryHeaders(message, attempt),
      timeoutMs: this.policy.publishConfirmTimeoutMs,
    });
  }

  private rejectToDeadLetterExchange(
    channel: IRmqChannel,
    message: IRmqMessage,
    attempt: number,
    error: unknown,
  ): RetryOutcome {
    this.logger.error({ attempt }, REPUBLISH_FAILED_LOG, error);
    channel.nack(message, false, false);

    return 'rejected';
  }
}
