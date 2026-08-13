import { type Collection } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';

import { ensureProcessingLogIndexes } from './ensure-processing-log-indexes.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ensureProcessingLogIndexes', () => {
  it('should create a unique compound index on importId and status, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_status_1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, status: 1 }, { unique: true });
  });
});
