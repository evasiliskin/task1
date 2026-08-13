import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { LogsSearchService } from './logs-search.service.js';

describe('LogsSearchService', () => {
  it('should delegate to searchLogs with the injected collection, when search is called', async () => {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const collection = {
      find: vi.fn().mockReturnValue(cursor),
    } as unknown as Collection<IProcessingLogDocument>;
    const service = new LogsSearchService(collection);

    const result = await service.search({ limit: 50 });

    expect(result).toEqual({ data: [] });
  });
});
