import { RetryPublisher } from './retry-publisher.js';
import {
  type IRmqChannel,
  type IRmqMessage,
  type IRmqReturnedMessage,
  type RmqPublishCallback,
  type RmqReturnListener,
} from './rmq-channel.types.js';

interface IFakeChannel extends IRmqChannel {
  returnMessage: (message: IRmqReturnedMessage) => void;
}

function buildChannel(overrides: Partial<IRmqChannel> = {}): IFakeChannel {
  const listeners = new Set<RmqReturnListener>();

  return {
    ack: vi.fn(),
    nack: vi.fn(),
    sendToQueue: vi.fn(
      (_queue: string, _content: Buffer, _options?: unknown, callback?: RmqPublishCallback) => {
        callback?.(null);

        return true;
      },
    ),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((_event: 'return', listener: RmqReturnListener) => listeners.add(listener)),
    off: vi.fn((_event: 'return', listener: RmqReturnListener) => listeners.delete(listener)),
    returnMessage: (message: IRmqReturnedMessage) => {
      listeners.forEach((listener) => {
        listener(message);
      });
    },
    ...overrides,
  };
}

function buildMessage(retryCount?: number): IRmqMessage {
  return {
    content: Buffer.from('{"importId":"x"}'),
    properties: { headers: retryCount === undefined ? {} : { 'x-retry-count': retryCount } },
  };
}

function buildPublisher(
  channelOverrides: Partial<IRmqChannel> = {},
  publishConfirmTimeoutMs = 10_000,
) {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const publisher = new RetryPublisher(
    { main: 'q', retry: 'q.retry', deadLetter: 'q.dlq' },
    { maxRetries: 2, retryDelayMs: 1000, maxRetryDelayMs: 60_000, publishConfirmTimeoutMs },
    { getLogger: () => logger },
  );

  return { publisher, logger, channel: buildChannel(channelOverrides) };
}

describe('RetryPublisher.settleFailure', () => {
  it('should republish to the retry queue with an incremented count and a delay, when retries remain', async () => {
    const { publisher, channel } = buildPublisher();
    const message = buildMessage();

    const outcome = await publisher.settleFailure(channel, message, new Error('mongo down'));

    expect(outcome).toBe('retried');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'q.retry',
      message.content,
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        headers: expect.objectContaining({ 'x-retry-count': 1 }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        expiration: expect.any(String),
        persistent: true,
        mandatory: true,
      }),
      expect.any(Function),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('should dead-letter the message, when the retry count exceeds maxRetries', async () => {
    const { publisher, channel } = buildPublisher();
    const message = buildMessage(2);

    const outcome = await publisher.settleFailure(channel, message, new Error('still down'));

    expect(outcome).toBe('dead-lettered');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'q.dlq',
      message.content,
      expect.objectContaining({ persistent: true, mandatory: true }),
      expect.any(Function),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('should nack without requeue, when the broker nacks the republish', async () => {
    const { publisher, channel } = buildPublisher({
      sendToQueue: vi.fn(
        (_queue: string, _content: Buffer, _options?: unknown, callback?: RmqPublishCallback) => {
          callback?.(new Error('broker nack'));

          return true;
        },
      ),
    });
    const message = buildMessage();

    const outcome = await publisher.settleFailure(channel, message, new Error('boom'));

    expect(outcome).toBe('rejected');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('should nack without requeue, when the retry queue is missing and the message is returned', async () => {
    const channel = buildChannel();

    channel.sendToQueue = vi.fn(
      (_queue: string, _content: Buffer, options?: { messageId?: string }) => {
        channel.returnMessage({ properties: { messageId: options?.messageId } });

        return true;
      },
    );

    const publisher = new RetryPublisher(
      { main: 'q', retry: 'q.retry', deadLetter: 'q.dlq' },
      {
        maxRetries: 2,
        retryDelayMs: 1000,
        maxRetryDelayMs: 60_000,
        publishConfirmTimeoutMs: 10_000,
      },
      { getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) },
    );

    const message = buildMessage();
    const outcome = await publisher.settleFailure(channel, message, new Error('boom'));

    expect(outcome).toBe('rejected');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('should nack without requeue, when the republish throws', async () => {
    const { publisher, channel } = buildPublisher({
      sendToQueue: vi.fn().mockImplementation(() => {
        throw new Error('channel closed');
      }),
    });

    const outcome = await publisher.settleFailure(channel, buildMessage(), new Error('boom'));

    expect(outcome).toBe('rejected');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('should nack without requeue instead of hanging, when the broker never confirms the republish', async () => {
    const { publisher, channel } = buildPublisher({ sendToQueue: vi.fn(() => true) }, 5);
    const message = buildMessage();

    const outcome = await publisher.settleFailure(channel, message, new Error('boom'));

    expect(outcome).toBe('rejected');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('should nack without requeue instead of hanging, when the broker never confirms the dead-letter publish', async () => {
    const { publisher, channel } = buildPublisher({ sendToQueue: vi.fn(() => true) }, 5);
    const message = buildMessage(2);

    const outcome = await publisher.settleFailure(channel, message, new Error('boom'));

    expect(outcome).toBe('rejected');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('should not call assertQueue, when a failure is settled', async () => {
    const { publisher, channel } = buildPublisher();

    await publisher.settleFailure(channel, buildMessage(), new Error('boom'));

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.assertQueue).not.toHaveBeenCalled();
  });
});
