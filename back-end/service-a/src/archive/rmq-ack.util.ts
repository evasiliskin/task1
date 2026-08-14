import { type RmqContext } from '@nestjs/microservices';

interface IAckableChannel {
  ack(message: unknown): void;
}

export function ackMessage(context: RmqContext): void {
  const channel = context.getChannelRef() as IAckableChannel;

  channel.ack(context.getMessage());
}
