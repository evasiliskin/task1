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
