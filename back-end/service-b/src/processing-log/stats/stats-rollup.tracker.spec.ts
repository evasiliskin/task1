import { type IProcessingLogDocument } from '../processing-log.types.js';

import { StatsRollupTracker } from './stats-rollup.tracker.js';
import { STATS_ROLLUP_ID } from './stats-rollup.types.js';

function buildEntry(
  status: IProcessingLogDocument['status'],
  metadata: Record<string, number> = {},
): IProcessingLogDocument {
  return {
    importId: '11111111-1111-4111-8111-111111111111',
    eventType: 'github.import.completed',
    service: 'service-a',
    status,
    timestamp: new Date('2026-08-11T00:00:00Z'),
    correlationId: 'c1',
    archive: '2026-08-11-0.json.gz',
    metadata,
  };
}

describe('StatsRollupTracker', () => {
  it('should increment the singleton rollup for a completed entry', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const tracker = new StatsRollupTracker({ updateOne } as never);

    await tracker.applyEntry(buildEntry('completed', { eventsProcessed: 10, validEvents: 9 }));

    expect(updateOne).toHaveBeenCalledWith(
      { _id: STATS_ROLLUP_ID },
      {
        $inc: {
          archivesProcessed: 1,
          eventsProcessed: 10,
          successfulEvents: 9,
          invalidEvents: 0,
          errors: 0,
        },
      },
      { upsert: true },
    );
  });

  it('should not touch the database for an entry that contributes nothing', async () => {
    const updateOne = vi.fn();
    const tracker = new StatsRollupTracker({ updateOne } as never);

    await tracker.applyEntry(buildEntry('started'));

    expect(updateOne).not.toHaveBeenCalled();
  });

  it('should read the stored totals without the bookkeeping fields', async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: STATS_ROLLUP_ID,
      seededAt: new Date(),
      archivesProcessed: 2,
      eventsProcessed: 20,
      successfulEvents: 18,
      invalidEvents: 1,
      errors: 1,
    });
    const tracker = new StatsRollupTracker({ findOne } as never);

    await expect(tracker.read()).resolves.toEqual({
      archivesProcessed: 2,
      eventsProcessed: 20,
      successfulEvents: 18,
      invalidEvents: 1,
      errors: 1,
    });
  });

  it('should report undefined when the rollup has never been written', async () => {
    const tracker = new StatsRollupTracker({ findOne: vi.fn().mockResolvedValue(null) } as never);

    await expect(tracker.read()).resolves.toBeUndefined();
  });

  it('should report undefined when the document exists but has never been seeded', async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: STATS_ROLLUP_ID,
      archivesProcessed: 1,
      eventsProcessed: 10,
      successfulEvents: 9,
      invalidEvents: 0,
      errors: 0,
    });
    const tracker = new StatsRollupTracker({ findOne } as never);

    await expect(tracker.read()).resolves.toBeUndefined();
  });
});
