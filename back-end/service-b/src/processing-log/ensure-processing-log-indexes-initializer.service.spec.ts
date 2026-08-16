import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('EnsureProcessingLogIndexesInitializer', () => {
  it('should create the unique importId/status index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_status_1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const initializer = new EnsureProcessingLogIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, status: 1 }, { unique: true });
    expect(infoMock).toHaveBeenCalledWith({}, 'Ensured processing-logs collection indexes');
  });

  it('should create exactly four indexes (no TTL index), when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureProcessingLogIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledTimes(4);
  });

  it('should propagate the error, when index creation fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureProcessingLogIndexesInitializer(collection, loggerService);

    await expect(initializer.onModuleInit()).rejects.toThrow('connection refused');
  });
});
