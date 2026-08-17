import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { type MongodbConfiguration } from '../config/mongodb.config.js';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

const RETENTION_MS = 604_800_000;

function buildInitializer(
  createIndex: ReturnType<typeof vi.fn>,
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } = {
    info: vi.fn(),
    warn: vi.fn(),
  },
): EnsureProcessingLogIndexesInitializer {
  const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;
  const loggerService = {
    getLogger: vi.fn().mockReturnValue(logger),
  } as unknown as LoggerService;

  return new EnsureProcessingLogIndexesInitializer(
    collection,
    { processingLogRetentionMs: RETENTION_MS } as MongodbConfiguration,
    loggerService,
  );
}

describe('EnsureProcessingLogIndexesInitializer', () => {
  it('should create the unique importId/status index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_status_1');
    const logger = { info: vi.fn(), warn: vi.fn() };

    await buildInitializer(createIndex, logger).onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, status: 1 }, { unique: true });
    expect(logger.info).toHaveBeenCalledWith({}, 'Ensured processing-logs collection indexes');
  });

  it('should create the four query indexes and the TTL retention index, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await buildInitializer(createIndex).onModuleInit();

    expect(createIndex).toHaveBeenCalledTimes(5);
    expect(createIndex).toHaveBeenCalledWith({ timestamp: 1 }, { expireAfterSeconds: 604_800 });
  });

  it('should propagate the error, when creating the query indexes fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(buildInitializer(createIndex).onModuleInit()).rejects.toThrow(
      'connection refused',
    );
  });

  it('should warn and continue, when the retention index cannot be applied', async () => {
    const failure = new Error('not authorized on admin');
    const createIndex = vi
      .fn()
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(failure);
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(buildInitializer(createIndex, logger).onModuleInit()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith({}, expect.any(String), failure);
  });
});
