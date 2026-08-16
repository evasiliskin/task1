import { QueueTopologyInitializer } from './queue-topology.initializer.js';

describe('QueueTopologyInitializer', () => {
  it('should declare the retry and dead-letter queues once', async () => {
    const assertQueue = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({
      createChannel: () => ({ assertQueue, close }),
      close,
    });

    const initializer = new QueueTopologyInitializer(
      { main: 'q', retry: 'q.retry', deadLetter: 'q.dlq' },
      'amqp://localhost',
      { getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
      connect,
    );

    await initializer.onApplicationBootstrap();

    expect(assertQueue).toHaveBeenCalledWith('q.dlq', { durable: true });
    expect(assertQueue).toHaveBeenCalledWith('q.retry', {
      durable: true,
      arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'q' },
    });
    expect(close).toHaveBeenCalled();
  });

  it('should not prevent startup when the broker is unreachable', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const warn = vi.fn();

    const initializer = new QueueTopologyInitializer(
      { main: 'q', retry: 'q.retry', deadLetter: 'q.dlq' },
      'amqp://localhost',
      { getLogger: () => ({ info: vi.fn(), warn, error: vi.fn() }) },
      connect,
    );

    await expect(initializer.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
