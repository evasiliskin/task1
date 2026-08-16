import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';
import { type IRmqChannel, type IRmqMessage } from '@task1/shared/messaging/rmq-channel.types';

import { ImportAlreadyClaimedError } from './import-claim.error.js';

const ALREADY_CLAIMED_LOG = 'Import already claimed by another consumer, skipping duplicate';

export interface ISettleImportOptions {
  run: () => Promise<unknown>;
  channel: IRmqChannel;
  message: IRmqMessage;
  retryPublisher: RetryPublisher;
  logger: AppLogger;
  importId: string;
}

/**
 * Runs one import and decides the message's fate.
 *
 * The acknowledgement is deliberately NOT in a `finally`: acking tells the broker the work is done,
 * so acking a failed import destroys it. A claimed-duplicate still acks — redelivering it would
 * only produce the same benign collision.
 */
export async function settleImportResult(options: ISettleImportOptions): Promise<void> {
  try {
    await options.run();
  } catch (error) {
    if (error instanceof ImportAlreadyClaimedError) {
      options.logger.info({ importId: options.importId }, ALREADY_CLAIMED_LOG);
      options.channel.ack(options.message);

      return;
    }

    await options.retryPublisher.settleFailure(options.channel, options.message, error);

    return;
  }

  options.channel.ack(options.message);
}
