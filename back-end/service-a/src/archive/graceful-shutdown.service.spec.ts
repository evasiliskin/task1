import { GracefulShutdownService } from './graceful-shutdown.service.js';

function buildService(
  drain: ReturnType<typeof vi.fn>,
  size = 1,
): {
  service: GracefulShutdownService;
  beginShutdown: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const beginShutdown = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();

  return {
    service: new GracefulShutdownService(
      { drain, beginShutdown, size } as never,
      { shutdownDrainTimeoutMs: 5000 } as never,
      { getLogger: () => ({ info, warn }) } as never,
    ),
    beginShutdown,
    info,
    warn,
  };
}

describe('GracefulShutdownService', () => {
  it('should stop admitting imports before draining, when shutdown starts', async () => {
    const order: string[] = [];
    const drain = vi.fn().mockImplementation(() => {
      order.push('drain');

      return Promise.resolve(true);
    });
    const { service, beginShutdown } = buildService(drain);

    beginShutdown.mockImplementation(() => order.push('beginShutdown'));

    await service.onModuleDestroy();

    expect(order).toEqual(['beginShutdown', 'drain']);
  });

  it('should wait for the drain to finish, when imports are in flight', async () => {
    const drain = vi.fn().mockResolvedValue(true);
    const { service, info } = buildService(drain);

    await service.onModuleDestroy();

    expect(drain).toHaveBeenCalledWith(5000);
    expect(info).toHaveBeenCalled();
  });

  it('should warn without throwing, when the drain times out', async () => {
    const drain = vi.fn().mockResolvedValue(false);
    const { service, warn } = buildService(drain);

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('should still stop admitting imports and drain, when nothing was in flight', async () => {
    const drain = vi.fn().mockResolvedValue(true);
    const { service, beginShutdown, info } = buildService(drain, 0);

    await service.onModuleDestroy();

    expect(beginShutdown).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith(5000);
    expect(info).not.toHaveBeenCalled();
  });
});
