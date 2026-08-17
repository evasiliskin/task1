import { getRetryCount, isRedelivered } from '@task1/shared/messaging/retry-headers.util';
import { type IRmqMessage } from '@task1/shared/messaging/rmq-channel.types';

export type ImportDeliveryKind = 'fresh' | 'retry' | 'redelivery';

export function classifyImportDelivery(message: IRmqMessage): ImportDeliveryKind {
  if (isRedelivered(message)) {
    return 'redelivery';
  }

  return getRetryCount(message) > 0 ? 'retry' : 'fresh';
}
