import { type MongoClient } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';

import { createProcessingLogCollection } from './processing-log-collection.provider.js';

describe('createProcessingLogCollection', () => {
  it('should return the processing-logs collection from the client default database, when called', () => {
    const collection = { collectionName: 'processing-logs' };
    const collectionFunction = vi.fn().mockReturnValue(collection);
    const db = vi.fn().mockReturnValue({ collection: collectionFunction });
    const client = { db } as unknown as MongoClient;

    const result = createProcessingLogCollection(client);

    expect(result).toBe(collection);
    expect(collectionFunction).toHaveBeenCalledWith('processing-logs');
  });
});
