import { RetryPublisher } from './retry-publisher.js';
import { type IRmqChannel, type IRmqMessage } from './rmq-channel.types.js';

function buildChannel(overrides: Partial<IRmqChannel> = {}): IRmqChannel {
  return {
    ack: vi.fn(),
    nack: vi.fn(),
    sendToQueue: vi.fn().mockReturnValue(true),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildMessage(retryCount?: number): IRmqMessage {
  return {
    content: Buffer.from('{"importId":"x"}'),
    properties: { headers: retryCount === undefined ? {} : { 'x-retry-count': retryCount } },
  };
}

function buildPublisher(channelOverrides: Partial<IRmqChannel> = {}) {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const publisher = new RetryPublisher(
    { main: 'q', retry: 'q.retry', deadLetter: 'q.dlq' },
    { maxRetries: 2, retryDelayMs: 1000, maxRetryDelayMs: 60_000 },
    { getLogger: () => logger },
  );

  return { publisher, logger, channel: buildChannel(channelOverrides) };
}

describe('RetryPublisher.settleFailure', () => {
  it('should republish to the retry queue with an incremented count and a delay', async () => {
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
      }),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('should dead-letter once the retry count exceeds maxRetries', async () => {
    const { publisher, channel } = buildPublisher();
    const message = buildMessage(2);

    const outcome = await publisher.settleFailure(channel, message, new Error('still down'));

    expect(outcome).toBe('dead-lettered');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.sendToQueue).toHaveBeenCalledWith('q.dlq', message.content, expect.anything());
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('should nack without requeue when the republish is refused', async () => {
    const { publisher, channel } = buildPublisher({ sendToQueue: vi.fn().mockReturnValue(false) });
    const message = buildMessage();

    const outcome = await publisher.settleFailure(channel, message, new Error('boom'));

    expect(outcome).toBe('rejected');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('should nack without requeue when the republish throws', async () => {
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

  it('should never call assertQueue on the message path', async () => {
    const { publisher, channel } = buildPublisher();

    await publisher.settleFailure(channel, buildMessage(), new Error('boom'));

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(channel.assertQueue).not.toHaveBeenCalled();
  });
});
