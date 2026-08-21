import { type MongoClient } from 'mongodb';

import { createEventsCollection } from './events-collection.provider.js';

describe('createEventsCollection', () => {
  it('should return the events collection from the client default database, when called', () => {
    const collection = { collectionName: 'events' };
    const collectionFunction = vi.fn().mockReturnValue(collection);
    const db = vi.fn().mockReturnValue({ collection: collectionFunction });
    const client = { db } as unknown as MongoClient;

    const result = createEventsCollection(client);

    expect(result).toBe(collection);
    expect(collectionFunction).toHaveBeenCalledWith('events');
  });
});
