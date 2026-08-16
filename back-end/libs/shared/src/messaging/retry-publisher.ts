import { Inject, Injectable } from '@nestjs/common';

import { type AppLogger } from '../logger/app-logger.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';
import { LOGGER_FACTORY } from '../logger/logger.tokens.js';

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
}

export const RETRY_SCHEDULED_LOG = 'handler failed, republishing with an incremented retry count';
export const DEAD_LETTERED_LOG =
  'handler failed at maxRetries, moving message to the dead-letter queue';
export const REPUBLISH_FAILED_LOG =
  'retry/dead-letter republish failed, dead-lettering the original message';

/**
 * Owns what happens to a message when its handler fails.
 *
 * Consumers decide what work to do; this decides the delivery outcome. Queues are declared once at
 * bootstrap by `QueueTopologyInitializer`, so nothing here touches `assertQueue` — a per-message
 * `assertQueue` costs a broker round-trip on every failure and closes the channel with
 * PRECONDITION_FAILED if the arguments ever drift.
 */
@Injectable()
export class RetryPublisher {
  public constructor(
    @Inject(QUEUE_TOPOLOGY) private readonly topology: IQueueTopology,
    @Inject(RETRY_POLICY) private readonly policy: IRetryPolicy,
    @Inject(LOGGER_FACTORY) loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.getLogger(RetryPublisher.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the method is async by contract (RetryPublisher may gain an async publish step later); every call site already awaits it.
  public async settleFailure(
    channel: IRmqChannel,
    message: IRmqMessage,
    error: unknown,
  ): Promise<RetryOutcome> {
    const attempt = getRetryCount(message) + 1;
    const isExhausted = attempt > this.policy.maxRetries;

    try {
      const accepted = isExhausted
        ? this.publishDeadLetter(message, attempt, channel)
        : this.publishRetry(message, attempt, channel);

      if (!accepted) {
        return this.rejectToDeadLetterExchange(channel, message, attempt, error);
      }
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

  private publishRetry(message: IRmqMessage, attempt: number, channel: IRmqChannel): boolean {
    const delayMs = computeRetryDelayMs(
      attempt,
      this.policy.retryDelayMs,
      this.policy.maxRetryDelayMs,
    );

    return channel.sendToQueue(this.topology.retry, message.content, {
      headers: buildRetryHeaders(message, attempt),
      expiration: String(delayMs),
    });
  }

  private publishDeadLetter(message: IRmqMessage, attempt: number, channel: IRmqChannel): boolean {
    return channel.sendToQueue(this.topology.deadLetter, message.content, {
      headers: buildRetryHeaders(message, attempt),
    });
  }

  /**
   * `requeue: false`, never `true`. Requeueing redelivers immediately, the same failure recurs
   * immediately, and the result is a CPU-bound redelivery loop that also floods the log. With the
   * main queue carrying an `x-dead-letter-exchange`, a rejected message lands in the DLQ instead.
   */
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
