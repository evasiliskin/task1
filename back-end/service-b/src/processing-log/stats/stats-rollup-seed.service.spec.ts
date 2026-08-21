import { StatsRollupSeedService } from './stats-rollup-seed.service.js';
import { STATS_ROLLUP_ID } from './stats-rollup.types.js';

function buildService(options: {
  existing?: unknown;
  groups?: unknown[];
  updateOne?: ReturnType<typeof vi.fn>;
  aggregate?: ReturnType<typeof vi.fn>;
  info?: ReturnType<typeof vi.fn>;
  warn?: ReturnType<typeof vi.fn>;
}) {
  const updateOne = options.updateOne ?? vi.fn().mockResolvedValue({});
  const aggregate =
    options.aggregate ??
    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(options.groups ?? []) });
  const findOne = vi.fn().mockResolvedValue(options.existing ?? null);

  return {
    service: new StatsRollupSeedService(
      { aggregate } as never,
      { findOne, updateOne } as never,
      { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
      {
        getLogger: () => ({ info: options.info ?? vi.fn(), warn: options.warn ?? vi.fn() }),
      } as never,
    ),
    updateOne,
    aggregate,
  };
}

describe('StatsRollupSeedService', () => {
  it('should seed the rollup from the aggregation, when it has never been seeded', async () => {
    const { service, updateOne } = buildService({
      groups: [
        {
          _id: 'completed',
          count: 2,
          eventsProcessed: 100,
          validEvents: 90,
          invalidEvents: 6,
          errorCount: 4,
        },
        {
          _id: 'failed',
          count: 1,
          eventsProcessed: 0,
          validEvents: 0,
          invalidEvents: 0,
          errorCount: 0,
        },
      ],
    });

    await service.onApplicationBootstrap();

    expect(updateOne).toHaveBeenCalledWith(
      { _id: STATS_ROLLUP_ID },
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        $set: expect.objectContaining({
          archivesProcessed: 2,
          eventsProcessed: 100,
          successfulEvents: 90,
          invalidEvents: 6,
          errors: 5,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(Date) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
          seededAt: expect.any(Date),
        }),
      },
      { upsert: true },
    );
  });

  it('should not re-seed the rollup, when it already carries seededAt', async () => {
    const { service, updateOne, aggregate } = buildService({
      existing: { _id: STATS_ROLLUP_ID, seededAt: new Date() },
    });

    await service.onApplicationBootstrap();

    expect(aggregate).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('should correct the rollup, when an increment created it before the first seed', async () => {
    const { service, updateOne } = buildService({
      existing: { _id: STATS_ROLLUP_ID, errors: 1 },
      groups: [],
    });

    await service.onApplicationBootstrap();

    expect(updateOne).toHaveBeenCalled();
  });

  it('should not prevent startup, when the aggregation fails', async () => {
    const warn = vi.fn();
    const { service } = buildService({
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(new Error('mongo down')),
      }),
      warn,
    });

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
