import { type Collection } from 'mongodb';

import { ensureImportIndexes } from './ensure-import-indexes.js';
import { type IImportRunDocument } from './import-run.types.js';

describe('ensureImportIndexes', () => {
  it('should create a unique index on importId, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;

    await ensureImportIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1 }, { unique: true });
  });

  it('should create a compound index on status and startedAt, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('status_1_startedAt_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;

    await ensureImportIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ status: 1, startedAt: 1 });
  });

  it('should create a partial unique index on idempotencyKey, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('idempotencyKey_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;

    await ensureImportIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith(
      { idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
    );
  });

  it('should create a partial index on claimedAt scoped to rows that have one, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('claimedAt_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;

    await ensureImportIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith(
      { claimedAt: 1 },
      { partialFilterExpression: { claimedAt: { $exists: true } } },
    );
  });

  it('should create every index without serialising the round trips', async () => {
    let inFlight = 0;
    let peak = 0;
    const createIndex = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await ensureImportIndexes({ createIndex } as never);

    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(peak).toBeGreaterThan(1);
  });
});
