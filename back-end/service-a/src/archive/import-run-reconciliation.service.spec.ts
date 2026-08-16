import { ImportRunReconciliationService } from './import-run-reconciliation.service.js';

function buildService(failStaleRuns: ReturnType<typeof vi.fn>, info = vi.fn()) {
  return new ImportRunReconciliationService(
    { failStaleRuns } as never,
    { downloadTotalTimeoutMs: 600_000 } as never,
    { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
    { getLogger: () => ({ info, warn: vi.fn() }) } as never,
  );
}

describe('ImportRunReconciliationService', () => {
  it('should fail runs older than the staleness threshold', async () => {
    const failStaleRuns = vi.fn().mockResolvedValue(3);

    await buildService(failStaleRuns).onApplicationBootstrap();

    expect(failStaleRuns).toHaveBeenCalledWith(
      expect.any(Date),
      expect.stringContaining('interrupted'),
    );
  });

  it('should log only when something was reconciled', async () => {
    const info = vi.fn();

    await buildService(vi.fn().mockResolvedValue(0), info).onApplicationBootstrap();

    expect(info).not.toHaveBeenCalled();
  });

  it('should not prevent startup when the update fails', async () => {
    const failStaleRuns = vi.fn().mockRejectedValue(new Error('mongo down'));

    await expect(buildService(failStaleRuns).onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
