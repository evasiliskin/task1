import { ImportRunReconciliationService } from './import-run-reconciliation.service.js';

function buildService(
  failStaleRuns: ReturnType<typeof vi.fn>,
  info = vi.fn(),
  expireStaleClaims: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(0),
  warn = vi.fn(),
) {
  return new ImportRunReconciliationService(
    { failStaleRuns, expireStaleClaims } as never,
    { downloadTotalTimeoutMs: 600_000 } as never,
    { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
    { getLogger: () => ({ info, warn }) } as never,
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

  it('should also expire stale claim-only reservations, using the same cutoff', async () => {
    const expireStaleClaims = vi.fn().mockResolvedValue(2);

    await buildService(
      vi.fn().mockResolvedValue(0),
      vi.fn(),
      expireStaleClaims,
    ).onApplicationBootstrap();

    expect(expireStaleClaims).toHaveBeenCalledWith(expect.any(Date));
  });

  it('should log only when a claim was expired', async () => {
    const info = vi.fn();

    await buildService(
      vi.fn().mockResolvedValue(0),
      info,
      vi.fn().mockResolvedValue(0),
    ).onApplicationBootstrap();

    expect(info).not.toHaveBeenCalled();
  });

  it('should log when claims were expired', async () => {
    const info = vi.fn();

    await buildService(
      vi.fn().mockResolvedValue(0),
      info,
      vi.fn().mockResolvedValue(2),
    ).onApplicationBootstrap();

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
      expect.stringContaining('Expired'),
    );
  });

  it('should not prevent startup when expiring stale claims fails', async () => {
    const expireStaleClaims = vi.fn().mockRejectedValue(new Error('mongo down'));

    await expect(
      buildService(
        vi.fn().mockResolvedValue(0),
        vi.fn(),
        expireStaleClaims,
      ).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('should run failStaleRuns even when expireStaleClaims fails, and vice versa', async () => {
    const failStaleRuns = vi.fn().mockResolvedValue(0);
    const expireStaleClaims = vi.fn().mockRejectedValue(new Error('mongo down'));

    await buildService(failStaleRuns, vi.fn(), expireStaleClaims).onApplicationBootstrap();

    expect(failStaleRuns).toHaveBeenCalled();
  });
});
