import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { EnsureImportIndexesInitializer } from './ensure-import-indexes-initializer.service.js';
import { type IImportRunDocument } from './import-run.types.js';

describe('EnsureImportIndexesInitializer', () => {
  it('should create the unique importId index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const initializer = new EnsureImportIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ importId: 1 }, { unique: true });
    expect(infoMock).toHaveBeenCalledWith({}, 'Ensured imports collection indexes');
  });

  it('should propagate the error, when index creation fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureImportIndexesInitializer(collection, loggerService);

    await expect(initializer.onModuleInit()).rejects.toThrow('connection refused');
  });
});
