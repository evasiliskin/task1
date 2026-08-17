import { MessagePublishFailedError } from '../errors/external/message-publish-failed.error.js';

import { publishConfirmed } from './confirm-publish.js';
import {
  type IRmqChannel,
  type IRmqPublishOptions,
  type IRmqReturnedMessage,
  type RmqPublishCallback,
  type RmqReturnListener,
} from './rmq-channel.types.js';

interface IFakeChannel extends IRmqChannel {
  listenerCount: () => number;
  returnMessage: (message: IRmqReturnedMessage) => void;
}

function buildChannel(sendToQueue: IRmqChannel['sendToQueue']): IFakeChannel {
  const listeners = new Set<RmqReturnListener>();

  return {
    ack: vi.fn(),
    nack: vi.fn(),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    sendToQueue,
    on: (_event: 'return', listener: RmqReturnListener) => listeners.add(listener),
    off: (_event: 'return', listener: RmqReturnListener) => listeners.delete(listener),
    listenerCount: () => listeners.size,
    returnMessage: (message: IRmqReturnedMessage) => {
      listeners.forEach((listener) => {
        listener(message);
      });
    },
  };
}

const fixture = {
  content: Buffer.from('{"importId":"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"}'),
  headers: { 'x-retry-count': 1 },
  timeoutMs: 10_000,
};

describe('publishConfirmed', () => {
  it('should resolve, when the broker confirms the publish', async () => {
    const channel = buildChannel(
      (_queue: string, _content: Buffer, _options?: unknown, callback?: RmqPublishCallback) => {
        callback?.(null);

        return true;
      },
    );

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: fixture.timeoutMs,
      }),
    ).resolves.toBeUndefined();
  });

  it('should publish persistent and mandatory with the retry headers and expiration, when an expiration is given', async () => {
    let published: IRmqPublishOptions | undefined;

    const channel = buildChannel(
      (
        _queue: string,
        _content: Buffer,
        options?: IRmqPublishOptions,
        callback?: RmqPublishCallback,
      ) => {
        published = options;
        callback?.(null);

        return true;
      },
    );

    await publishConfirmed({
      channel,
      queue: 'q.retry',
      content: fixture.content,
      headers: fixture.headers,
      timeoutMs: fixture.timeoutMs,
      expiration: '1000',
    });

    expect(published).toEqual({
      headers: fixture.headers,
      expiration: '1000',
      persistent: true,
      mandatory: true,
      messageId: expect.any(String) as string,
    });
  });

  it('should reject with MessagePublishFailedError, when the broker nacks the publish', async () => {
    const channel = buildChannel(
      (_queue: string, _content: Buffer, _options?: unknown, callback?: RmqPublishCallback) => {
        callback?.(new Error('broker nack'));

        return true;
      },
    );

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: fixture.timeoutMs,
      }),
    ).rejects.toThrow(MessagePublishFailedError);
  });

  it('should reject with MessagePublishFailedError, when the message is returned as unroutable', async () => {
    const channel: IFakeChannel = buildChannel(() => true);

    channel.sendToQueue = (_queue: string, _content: Buffer, options?: IRmqPublishOptions) => {
      channel.returnMessage({ properties: { messageId: options?.messageId } });

      return true;
    };

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: fixture.timeoutMs,
      }),
    ).rejects.toThrow(MessagePublishFailedError);
  });

  it('should ignore a return for another publish, when the returned messageId does not match', async () => {
    const channel: IFakeChannel = buildChannel(() => true);

    channel.sendToQueue = (
      _queue: string,
      _content: Buffer,
      _options?: IRmqPublishOptions,
      callback?: RmqPublishCallback,
    ) => {
      channel.returnMessage({ properties: { messageId: 'another-publish' } });
      callback?.(null);

      return true;
    };

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: fixture.timeoutMs,
      }),
    ).resolves.toBeUndefined();
  });

  it('should remove its return listener, when the publish settles', async () => {
    const channel = buildChannel(
      (_queue: string, _content: Buffer, _options?: unknown, callback?: RmqPublishCallback) => {
        callback?.(null);

        return true;
      },
    );

    await publishConfirmed({
      channel,
      queue: 'q.retry',
      content: fixture.content,
      headers: fixture.headers,
      timeoutMs: fixture.timeoutMs,
    });

    expect(channel.listenerCount()).toBe(0);
  });

  it('should reject with MessagePublishFailedError, when the broker never confirms within the deadline', async () => {
    const channel = buildChannel(() => true);

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(MessagePublishFailedError);
  });

  it('should remove its return listener, when the publish times out', async () => {
    const channel = buildChannel(() => true);

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(MessagePublishFailedError);

    expect(channel.listenerCount()).toBe(0);
  });

  it('should resolve without waiting for the deadline, when the broker confirms late but before it expires', async () => {
    const channel = buildChannel(
      (_queue: string, _content: Buffer, _options?: unknown, callback?: RmqPublishCallback) => {
        setTimeout(() => {
          callback?.(null);
        }, 5);

        return true;
      },
    );

    await expect(
      publishConfirmed({
        channel,
        queue: 'q.retry',
        content: fixture.content,
        headers: fixture.headers,
        timeoutMs: 1000,
      }),
    ).resolves.toBeUndefined();
  });
});
