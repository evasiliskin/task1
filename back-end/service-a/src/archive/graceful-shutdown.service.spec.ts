import { GracefulShutdownService } from './graceful-shutdown.service.js';

function buildService(drain: ReturnType<typeof vi.fn>, info = vi.fn(), warn = vi.fn()) {
  return {
    service: new GracefulShutdownService(
      { drain, size: 1 } as never,
      { shutdownDrainTimeoutMs: 5000 } as never,
      { getLogger: () => ({ info, warn }) } as never,
    ),
    info,
    warn,
  };
}

describe('GracefulShutdownService', () => {
  it('should wait for in-flight imports to drain', async () => {
    const drain = vi.fn().mockResolvedValue(true);
    const { service, info } = buildService(drain);

    await service.onModuleDestroy();

    expect(drain).toHaveBeenCalledWith(5000);
    expect(info).toHaveBeenCalled();
  });

  it('should warn but not throw when the drain times out', async () => {
    const drain = vi.fn().mockResolvedValue(false);
    const { service, warn } = buildService(drain);

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('should not log when nothing was in flight', async () => {
    const drain = vi.fn().mockResolvedValue(true);
    const info = vi.fn();
    const service = new GracefulShutdownService(
      { drain, size: 0 } as never,
      { shutdownDrainTimeoutMs: 5000 } as never,
      { getLogger: () => ({ info, warn: vi.fn() }) } as never,
    );

    await service.onModuleDestroy();

    expect(info).not.toHaveBeenCalled();
  });
});
