import { type ILoggerFactory } from '../logger/logger-factory.interface.js';

import { createRedisClient } from './create-redis-client.js';

describe('createRedisClient', () => {
  it('should log a warning rather than crash the process, when the client emits an error', async () => {
    const warn = vi.fn();
    const loggerFactory = {
      getLogger: () => ({ warn }),
    } as unknown as ILoggerFactory;

    const client = createRedisClient('redis://127.0.0.1:1', loggerFactory);

    client.emit('error', new Error('ECONNREFUSED'));

    expect(warn).toHaveBeenCalledWith(
      { suppressedCount: 0 },
      'Redis client error',
      expect.any(Error),
    );

    await client.quit().catch(() => undefined);
    client.disconnect();
  });

  it('should log at most one error per interval, when the client error-storms', () => {
    const warn = vi.fn();
    const loggerFactory = { getLogger: () => ({ warn }) } as unknown as ILoggerFactory;
    const client = createRedisClient('redis://127.0.0.1:1', loggerFactory);

    for (let index = 0; index < 100; index += 1) {
      client.emit('error', new Error('ECONNREFUSED'));
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [{ suppressedCount: number }])[0]).toMatchObject({
      suppressedCount: 0,
    });

    client.disconnect();
  });
});
