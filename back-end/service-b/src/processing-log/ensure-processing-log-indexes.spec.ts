import { type Collection } from 'mongodb';

import {
  ensureProcessingLogIndexes,
  ensureProcessingLogRetentionIndex,
} from './ensure-processing-log-indexes.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ensureProcessingLogIndexes', () => {
  it('should create a unique compound index on importId and status, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_status_1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, status: 1 }, { unique: true });
  });

  it('should create the importId filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_timestamp_-1__id_-1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, timestamp: -1, _id: -1 });
  });

  it('should create the status filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('status_1_timestamp_-1__id_-1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ status: 1, timestamp: -1, _id: -1 });
  });

  it('should include the _id tiebreaker in every compound index, when the indexes are ensured', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await ensureProcessingLogIndexes({
      createIndex,
    } as unknown as Collection<IProcessingLogDocument>);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, timestamp: -1, _id: -1 });
    expect(createIndex).toHaveBeenCalledWith({ status: 1, timestamp: -1, _id: -1 });
  });

  it('should create the default pagination index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('timestamp_-1__id_-1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
  });

  it('should create exactly four indexes, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('index');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledTimes(4);
  });

  it('should create every index concurrently, when the indexes are ensured', async () => {
    let inFlight = 0;
    let peak = 0;
    const createIndex = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await ensureProcessingLogIndexes({ createIndex } as never);

    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('should not create a TTL index, when no retention is configured', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await ensureProcessingLogIndexes({ createIndex } as never);

    expect(createIndex).not.toHaveBeenCalledWith(
      { timestamp: 1 },
      expect.objectContaining({ expireAfterSeconds: expect.any(Number) as number }),
    );
  });
});

describe('ensureProcessingLogRetentionIndex', () => {
  it('should create a TTL index on timestamp, when a retention is configured', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await ensureProcessingLogRetentionIndex({ createIndex } as never, 86_400_000);

    expect(createIndex).toHaveBeenCalledWith({ timestamp: 1 }, { expireAfterSeconds: 86_400 });
  });

  it('should round the expiry up to one second, when the configured retention is sub-second', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await ensureProcessingLogRetentionIndex({ createIndex } as never, 500);

    expect(createIndex).toHaveBeenCalledWith({ timestamp: 1 }, { expireAfterSeconds: 1 });
  });

  it('should create exactly one index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await ensureProcessingLogRetentionIndex({ createIndex } as never, 2_592_000_000);

    expect(createIndex).toHaveBeenCalledTimes(1);
  });
});
