import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import { RedisConnectionService } from './redis-connection.service.js';

describe('RedisConnectionService', () => {
  let infoMock: ReturnType<typeof vi.fn>;
  let loggerService: LoggerService;

  beforeEach(() => {
    infoMock = vi.fn();
    loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
  });

  describe('onModuleInit', () => {
    it('should connect the Redis client and log success, when initialization succeeds', async () => {
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn(),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerService);

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
      const service = new RedisConnectionService(client, loggerService);

      await expect(service.onModuleInit()).rejects.toThrow('connection refused');
    });
  });

  describe('onModuleDestroy', () => {
    it('should gracefully close the Redis client, when destroyed', async () => {
      const client = {
        connect: vi.fn(),
        quit: vi.fn().mockResolvedValue('OK'),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerService);

      await service.onModuleDestroy();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
      expect(client.quit).toHaveBeenCalledTimes(1);
    });
  });
});
