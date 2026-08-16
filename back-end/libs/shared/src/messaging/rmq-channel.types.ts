/**
 * The subset of amqplib's channel this codebase actually uses. Declared here rather than importing
 * amqplib's own types: `RmqContext.getChannelRef()` returns `any`, so every call site would
 * otherwise need its own cast and its own eslint suppression.
 */
export interface IRmqMessage {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
}

export interface IRmqChannel {
  ack(message: IRmqMessage): void;
  nack(message: IRmqMessage, allUpTo: boolean, requeue: boolean): void;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: { headers?: Record<string, unknown>; expiration?: string },
  ): boolean;
  assertQueue(
    queue: string,
    options?: { durable?: boolean; arguments?: Record<string, unknown> },
  ): Promise<unknown>;
}
