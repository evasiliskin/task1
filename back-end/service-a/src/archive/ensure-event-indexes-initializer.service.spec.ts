import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';

describe('EnsureEventIndexesInitializer', () => {
  it('should create the unique eventId index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventId_1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const initializer = new EnsureEventIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ eventId: 1 }, { unique: true });
    expect(infoMock).toHaveBeenCalledWith({}, 'Ensured events collection indexes');
  });

  it('should propagate the error, when index creation fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureEventIndexesInitializer(collection, loggerService);

    await expect(initializer.onModuleInit()).rejects.toThrow('connection refused');
  });
});
