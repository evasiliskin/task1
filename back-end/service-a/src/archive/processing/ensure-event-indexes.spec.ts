import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { ensureEventIndexes } from './ensure-event-indexes.js';

describe('ensureEventIndexes', () => {
  it('should create a unique index on eventId, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventId_1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventId: 1 }, { unique: true });
  });
});
