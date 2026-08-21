import { type RmqContext } from '@nestjs/microservices';

import { EventsSearchController } from './events-search.controller.js';
import { type EventsSearchService } from './events-search.service.js';

function buildRmqContext(): RmqContext {
  return {
    getChannelRef: () => ({ ack: vi.fn() }),
    getMessage: () => ({ fields: { deliveryTag: 1 } }),
  } as unknown as RmqContext;
}

describe('EventsSearchController', () => {
  it('should validate the payload and delegate to EventsSearchService, when a valid message is received', async () => {
    const searchResult = { data: [] };
    const search = vi.fn().mockResolvedValue(searchResult);
    const eventsSearchService = { search } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    const result = await controller.handleSearch({ type: 'PushEvent' }, buildRmqContext());

    expect(result).toBe(searchResult);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ type: 'PushEvent', limit: 50 }));
  });

  it('should reject, when the payload fails schema validation', async () => {
    const search = vi.fn();
    const eventsSearchService = { search } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    await expect(controller.handleSearch({ limit: -1 }, buildRmqContext())).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });

  it('should ack the message, even when the handler throws an error', async () => {
    const ack = vi.fn();
    const context = {
      getChannelRef: () => ({ ack }),
      getMessage: () => ({ fields: { deliveryTag: 1 } }),
    } as unknown as RmqContext;
    const search = vi.fn().mockRejectedValue(new Error('boom'));
    const eventsSearchService = { search } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    await expect(controller.handleSearch({ type: 'PushEvent' }, context)).rejects.toThrow('boom');
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
