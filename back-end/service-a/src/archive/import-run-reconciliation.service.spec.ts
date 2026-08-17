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
  it('should fail the runs, when they are older than the staleness threshold', async () => {
    const failStaleRuns = vi.fn().mockResolvedValue(3);

    await buildService(failStaleRuns).onApplicationBootstrap();

    expect(failStaleRuns).toHaveBeenCalledWith(
      expect.any(Date),
      expect.stringContaining('interrupted'),
    );
  });

  it('should log, when at least one run was reconciled', async () => {
    const info = vi.fn();

    await buildService(vi.fn().mockResolvedValue(0), info).onApplicationBootstrap();

    expect(info).not.toHaveBeenCalled();
  });

  it('should not prevent startup, when the update fails', async () => {
    const failStaleRuns = vi.fn().mockRejectedValue(new Error('mongo down'));

    await expect(buildService(failStaleRuns).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('should expire stale claim-only reservations with the same cutoff, when reconciliation runs', async () => {
    const expireStaleClaims = vi.fn().mockResolvedValue(2);

    await buildService(
      vi.fn().mockResolvedValue(0),
      vi.fn(),
      expireStaleClaims,
    ).onApplicationBootstrap();

    expect(expireStaleClaims).toHaveBeenCalledWith(expect.any(Date));
  });

  it('should not log, when no claim was expired', async () => {
    const info = vi.fn();

    await buildService(
      vi.fn().mockResolvedValue(0),
      info,
      vi.fn().mockResolvedValue(0),
    ).onApplicationBootstrap();

    expect(info).not.toHaveBeenCalled();
  });

  it('should log, when claims were expired', async () => {
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

  it('should not prevent startup, when expiring stale claims fails', async () => {
    const expireStaleClaims = vi.fn().mockRejectedValue(new Error('mongo down'));

    await expect(
      buildService(
        vi.fn().mockResolvedValue(0),
        vi.fn(),
        expireStaleClaims,
      ).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('should still run the other reconciliation step, when one of them fails', async () => {
    const failStaleRuns = vi.fn().mockResolvedValue(0);
    const expireStaleClaims = vi.fn().mockRejectedValue(new Error('mongo down'));

    await buildService(failStaleRuns, vi.fn(), expireStaleClaims).onApplicationBootstrap();

    expect(failStaleRuns).toHaveBeenCalled();
  });
});
