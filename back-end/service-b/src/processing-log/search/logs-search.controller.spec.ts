import { type RmqContext } from '@nestjs/microservices';

import { LogsSearchController } from './logs-search.controller.js';
import { type LogsSearchService } from './logs-search.service.js';

describe('LogsSearchController', () => {
  function buildContext(): {
    context: RmqContext;
    message: Record<string, unknown>;
    ack: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('{}'), properties: { headers: {} } };
    const ack = vi.fn();
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack };
  }

  it('should validate the payload, delegate to LogsSearchService, and ack, when a valid message is received', async () => {
    const searchResult = { data: [] };
    const search = vi.fn().mockResolvedValue(searchResult);
    const logsSearchService = { search } as unknown as LogsSearchService;
    const controller = new LogsSearchController(logsSearchService);
    const { context, message, ack } = buildContext();

    const result = await controller.handleSearch({ status: 'completed' }, context);

    expect(result).toBe(searchResult);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', limit: 50 }),
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('should reject but still ack, when the payload fails schema validation', async () => {
    const search = vi.fn();
    const logsSearchService = { search } as unknown as LogsSearchService;
    const controller = new LogsSearchController(logsSearchService);
    const { context, message, ack } = buildContext();

    await expect(controller.handleSearch({ limit: -1 }, context)).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
  });
});
