import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { EventsSearchService } from './events-search.service.js';

describe('EventsSearchService', () => {
  function buildCollection(): Collection<IGithubEventDocument> {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };

    return { find: vi.fn().mockReturnValue(cursor) } as unknown as Collection<IGithubEventDocument>;
  }

  it('should delegate to searchEvents with the injected collection, when search is called', async () => {
    const collection = buildCollection();
    const service = new EventsSearchService(collection);

    const result = await service.search({ limit: 50 });

    expect(result).toEqual({ data: [] });
  });
});
