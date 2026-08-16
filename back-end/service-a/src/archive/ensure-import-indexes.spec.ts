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
});
