import { type RmqContext } from '@nestjs/microservices';

import { StatsController } from './stats.controller.js';
import { type StatsService } from './stats.service.js';

describe('StatsController', () => {
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

  it('should validate the payload, delegate to StatsService, and ack, when a valid message is received', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const statsResult = {
      archivesProcessed: 1,
      eventsProcessed: 1,
      successfulEvents: 1,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    };
    const getStats = vi.fn().mockResolvedValue(statsResult);
    const statsService = { getStats } as unknown as StatsService;
    const controller = new StatsController(statsService);
    const { context, message, ack } = buildContext();

    const result = await controller.handleGetStats({ importId }, context);

    expect(result).toBe(statsResult);
    expect(getStats).toHaveBeenCalledWith(importId);
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('should reject but still ack, when the payload fails schema validation', async () => {
    const getStats = vi.fn();
    const statsService = { getStats } as unknown as StatsService;
    const controller = new StatsController(statsService);
    const { context, message, ack } = buildContext();

    await expect(controller.handleGetStats({ importId: 'not-a-uuid' }, context)).rejects.toThrow();
    expect(getStats).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
  });
});
