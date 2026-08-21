import { type MongoClient } from 'mongodb';

import { createImportsCollection } from './imports-collection.provider.js';

describe('createImportsCollection', () => {
  it('should return the imports collection from the client default database, when called', () => {
    const collection = { collectionName: 'imports' };
    const collectionFunction = vi.fn().mockReturnValue(collection);
    const db = vi.fn().mockReturnValue({ collection: collectionFunction });
    const client = { db } as unknown as MongoClient;

    const result = createImportsCollection(client);

    expect(result).toBe(collection);
    expect(collectionFunction).toHaveBeenCalledWith('imports');
  });
});
