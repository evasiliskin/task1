import { EventsSearchController } from './events-search.controller.js';
import { type EventsSearchService } from './events-search.service.js';

describe('EventsSearchController', () => {
  it('should validate the payload and delegate to EventsSearchService, when a valid message is received', async () => {
    const searchResult = { data: [] };
    const search = vi.fn().mockResolvedValue(searchResult);
    const eventsSearchService = { search } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    const result = await controller.handleSearch({ type: 'PushEvent' });

    expect(result).toBe(searchResult);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ type: 'PushEvent', limit: 50 }));
  });

  it('should reject, when the payload fails schema validation', async () => {
    const search = vi.fn();
    const eventsSearchService = { search } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    await expect(controller.handleSearch({ limit: -1 })).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
});
