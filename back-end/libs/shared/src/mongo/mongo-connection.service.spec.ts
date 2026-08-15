import { type MongoClient } from 'mongodb';

import { type ILoggerFactory } from '../logger/logger-factory.interface.js';

import { MongoConnectionService } from './mongo-connection.service.js';

describe('MongoConnectionService', () => {
  let infoMock: ReturnType<typeof vi.fn>;
  let loggerFactory: ILoggerFactory;

  beforeEach(() => {
    infoMock = vi.fn();
    loggerFactory = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    };
  });

  describe('onModuleInit', () => {
    it('should connect the Mongo client and log success, when initialization succeeds', async () => {
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      } as unknown as MongoClient;
      const service = new MongoConnectionService(client, loggerFactory);

      await service.onModuleInit();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(infoMock).toHaveBeenCalledWith({}, 'Connected to MongoDB');
    });

    it('should propagate the error, when the Mongo client fails to connect', async () => {
      const client = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        close: vi.fn(),
      } as unknown as MongoClient;
      const service = new MongoConnectionService(client, loggerFactory);

      await expect(service.onModuleInit()).rejects.toThrow('connection refused');
    });
  });

  describe('onModuleDestroy', () => {
    it('should close the Mongo client, when destroyed', async () => {
      const client = {
        connect: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as MongoClient;
      const service = new MongoConnectionService(client, loggerFactory);

      await service.onModuleDestroy();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
      expect(client.close).toHaveBeenCalledTimes(1);
    });
  });
});
