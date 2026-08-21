import { type Redis } from 'ioredis';

import { type ILoggerFactory } from '../logger/logger-factory.interface.js';

import { RedisConnectionService } from './redis-connection.service.js';

describe('RedisConnectionService', () => {
  let infoMock: ReturnType<typeof vi.fn>;
  let loggerFactory: ILoggerFactory;

  beforeEach(() => {
    infoMock = vi.fn();
    loggerFactory = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    };
  });

  describe('onModuleInit', () => {
    it('should connect the Redis client and log success, when initialization succeeds', async () => {
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn(),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerFactory);

      await service.onModuleInit();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(infoMock).toHaveBeenCalledWith({}, 'Connected to Redis');
    });

    it('should propagate the error, when the Redis client fails to connect', async () => {
      const client = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        quit: vi.fn(),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerFactory);

      await expect(service.onModuleInit()).rejects.toThrow('connection refused');
    });
  });

  describe('onApplicationShutdown', () => {
    it('should gracefully close the Redis client, when destroyed', async () => {
      const client = {
        connect: vi.fn(),
        quit: vi.fn().mockResolvedValue('OK'),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerFactory);

      await service.onApplicationShutdown();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
      expect(client.quit).toHaveBeenCalledTimes(1);
    });
  });
});
