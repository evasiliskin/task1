import { type AppLogger } from '@task1/shared/logger/app-logger';
import { getRetryCount } from '@task1/shared/messaging/retry-headers.util';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';
import { type IRmqChannel, type IRmqMessage } from '@task1/shared/messaging/rmq-channel.types';

import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { classifyImportDelivery, type ImportDeliveryKind } from './import-delivery-kind.js';
import { ImportShuttingDownError } from './import-shutdown.error.js';

const ALREADY_CLAIMED_LOG = 'Import already claimed by another consumer, skipping duplicate';
const SHUTTING_DOWN_LOG =
  'Refused the delivery because the service is shutting down, requeueing it for another consumer';

export interface ISettleImportOptions {
  run: (delivery: ImportDeliveryKind) => Promise<unknown>;
  channel: IRmqChannel;
  message: IRmqMessage;
  retryPublisher: RetryPublisher;
  logger: AppLogger;
  importId: string;
}

export async function settleImportResult(options: ISettleImportOptions): Promise<void> {
  const retryCount = getRetryCount(options.message);

  try {
    await options.run(classifyImportDelivery(options.message));
  } catch (error) {
    if (error instanceof ImportShuttingDownError) {
      options.logger.info({ importId: options.importId, retryCount }, SHUTTING_DOWN_LOG);
      options.channel.nack(options.message, false, true);

      return;
    }

    if (error instanceof ImportAlreadyClaimedError) {
      options.logger.info({ importId: options.importId, retryCount }, ALREADY_CLAIMED_LOG);
      options.channel.ack(options.message);

      return;
    }

    await options.retryPublisher.settleFailure(options.channel, options.message, error);

    return;
  }

  options.channel.ack(options.message);
}
