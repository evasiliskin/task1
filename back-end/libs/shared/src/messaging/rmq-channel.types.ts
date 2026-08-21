export interface IRmqMessage {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
  fields?: { redelivered?: boolean };
}

export interface IRmqReturnedMessage {
  properties: { messageId?: string };
}

export interface IRmqPublishOptions {
  headers?: Record<string, unknown>;
  expiration?: string;
  persistent?: boolean;
  mandatory?: boolean;
  messageId?: string;
}

export type RmqReturnListener = (message: IRmqReturnedMessage) => void;

export type RmqPublishCallback = (error: unknown) => void;

export interface IRmqChannel {
  ack(message: IRmqMessage): void;
  nack(message: IRmqMessage, allUpTo: boolean, requeue: boolean): void;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: IRmqPublishOptions,
    callback?: RmqPublishCallback,
  ): boolean;
  assertQueue(
    queue: string,
    options?: { durable?: boolean; arguments?: Record<string, unknown> },
  ): Promise<unknown>;
  on(event: 'return', listener: RmqReturnListener): unknown;
  off(event: 'return', listener: RmqReturnListener): unknown;
}
