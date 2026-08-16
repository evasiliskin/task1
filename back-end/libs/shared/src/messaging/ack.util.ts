import { type RmqContext } from '@nestjs/microservices';

import { type IRmqChannel, type IRmqMessage } from './rmq-channel.types.js';

export function ackMessage(context: RmqContext): void {
  const channel = context.getChannelRef() as IRmqChannel;

  channel.ack(context.getMessage() as IRmqMessage);
}
