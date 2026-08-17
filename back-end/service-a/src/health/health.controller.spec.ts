import { type RmqContext } from '@nestjs/microservices';

import { HealthController } from './health.controller.js';

function buildContext(ack = vi.fn()): { context: RmqContext; ack: ReturnType<typeof vi.fn> } {
  const message = { content: Buffer.from('{}'), properties: {} };

  return {
    ack,
    context: {
      getChannelRef: () => ({ ack }),
      getMessage: () => message,
    } as unknown as RmqContext,
  };
}

describe('HealthController', () => {
  it('should check its dependencies with the configured timeout, when a health ping arrives', async () => {
    const result = { status: 'ok', details: { mongodb: { status: 'up' } } };
    const check = vi.fn().mockResolvedValue(result);
    const controller = new HealthController({ check } as never, { pingTimeoutMs: 2500 });
    const { context } = buildContext();

    await expect(controller.check(context)).resolves.toBe(result);
    expect(check).toHaveBeenCalledWith(2500);
  });

  it('should ack the message, even when a dependency is down', async () => {
    const check = vi.fn().mockResolvedValue({ status: 'error', details: {} });
    const controller = new HealthController({ check } as never, { pingTimeoutMs: 1000 });
    const { context, ack } = buildContext();

    await controller.check(context);

    expect(ack).toHaveBeenCalled();
  });

  it('should ack the message, even when the check throws', async () => {
    const check = vi.fn().mockRejectedValue(new Error('boom'));
    const controller = new HealthController({ check } as never, { pingTimeoutMs: 1000 });
    const { context, ack } = buildContext();

    await expect(controller.check(context)).rejects.toThrow('boom');
    expect(ack).toHaveBeenCalled();
  });
});
