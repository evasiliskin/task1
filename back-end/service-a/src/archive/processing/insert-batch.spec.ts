import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError } from 'mongodb';

import { insertBatch } from './insert-batch.js';

describe('insertBatch', () => {
  function buildDocument(eventId: string): IGithubEventDocument {
    return {
      eventId,
      eventType: 'PushEvent',
      createdAt: new Date('2026-08-11T00:00:00Z'),
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      importId: 'import-1',
      payload: {},
    };
  }

  function buildBulkWriteError(insertedCount: number, codes: number[]): MongoBulkWriteError {
    return Object.assign(new Error('bulk write failed'), {
      name: 'MongoBulkWriteError',
      insertedCount,
      writeErrors: codes.map((code) => ({ code })),
    }) as unknown as MongoBulkWriteError;
  }

  it('should return zero counts and not call insertMany, when the batch is empty', async () => {
    const insertMany = vi.fn();
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, []);

    expect(result).toEqual({ insertedCount: 0, duplicateCount: 0, errorCount: 0 });
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('should return the full insertedCount and zero errors, when every document inserts successfully', async () => {
    const batch = [buildDocument('e1'), buildDocument('e2')];
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 2 });
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, batch);

    expect(result).toEqual({ insertedCount: 2, duplicateCount: 0, errorCount: 0 });
    expect(insertMany).toHaveBeenCalledWith(batch, { ordered: false });
  });

  it('should count duplicate-key write errors separately from other errors, when the batch has both', async () => {
    const batch = [buildDocument('e1'), buildDocument('e2'), buildDocument('e3')];
    const bulkWriteError = buildBulkWriteError(1, [11000, 11000, 121]);
    const insertMany = vi.fn().mockRejectedValue(bulkWriteError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, batch);

    expect(result).toEqual({ insertedCount: 1, duplicateCount: 2, errorCount: 1 });
  });

  it('should count a single write error, when writeErrors arrives as one object instead of an array', async () => {
    const batch = [buildDocument('e1')];
    const bulkWriteError = Object.assign(new Error('bulk write failed'), {
      name: 'MongoBulkWriteError',
      insertedCount: 0,
      writeErrors: { code: 11000 },
    }) as unknown as MongoBulkWriteError;
    const insertMany = vi.fn().mockRejectedValue(bulkWriteError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, batch);

    expect(result).toEqual({ insertedCount: 0, duplicateCount: 1, errorCount: 0 });
  });

  it('should rethrow, when insertMany rejects with an error that is not a MongoBulkWriteError', async () => {
    const batch = [buildDocument('e1')];
    const connectionError = new Error('connection closed');
    const insertMany = vi.fn().mockRejectedValue(connectionError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    await expect(insertBatch(collection, batch)).rejects.toThrow('connection closed');
  });
});
