import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildAppliedEntryKey } from './applied-entry-key.js';
import { StatsRollupTracker } from './stats-rollup.tracker.js';
import { STATS_ROLLUP_ID } from './stats-rollup.types.js';

const IMPORT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function buildEntry(
  status: IProcessingLogDocument['status'],
  metadata: Record<string, number> = {},
): IProcessingLogDocument {
  return {
    importId: IMPORT_ID,
    eventType: `github.import.${status}`,
    service: 'service-a',
    status,
    timestamp: new Date('2026-08-11T00:00:00Z'),
    correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
    archive: '2026-08-11-0.json.gz',
    metadata,
  };
}

describe('StatsRollupTracker', () => {
  it('should increment the singleton rollup guarded by the applied-entry key, when the entry completed', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const tracker = new StatsRollupTracker({ updateOne } as never);
    const entry = buildEntry('completed', { eventsProcessed: 10, validEvents: 9 });

    await tracker.applyEntry(entry);

    expect(updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: STATS_ROLLUP_ID },
      { $setOnInsert: { appliedEntries: [] } },
      { upsert: true },
    );
    expect(updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: STATS_ROLLUP_ID, appliedEntries: { $ne: buildAppliedEntryKey(entry) } },
      {
        $inc: {
          archivesProcessed: 1,
          eventsProcessed: 10,
          successfulEvents: 9,
        },
        $push: { appliedEntries: buildAppliedEntryKey(entry) },
      },
    );
  });

  it('should record the applied-entry key in the same update as the increment, when the entry is applied', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const tracker = new StatsRollupTracker({ updateOne } as never);

    await tracker.applyEntry(buildEntry('failed'));

    const [, update] = updateOne.mock.calls[1] as [unknown, { $inc?: object; $push?: object }];

    expect(update.$inc).toBeDefined();
    expect(update.$push).toBeDefined();
  });

  it('should not touch the database, when the entry contributes nothing', async () => {
    const updateOne = vi.fn();
    const tracker = new StatsRollupTracker({ updateOne } as never);

    await tracker.applyEntry(buildEntry('started'));

    expect(updateOne).not.toHaveBeenCalled();
  });

  it('should return the stored totals without the bookkeeping fields, when the rollup is read', async () => {
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
    expect(findOne).toHaveBeenCalledWith(
      { _id: STATS_ROLLUP_ID },
      { projection: { appliedEntries: 0 } },
    );
  });

  it('should return undefined, when the rollup has never been written', async () => {
    const tracker = new StatsRollupTracker({ findOne: vi.fn().mockResolvedValue(null) } as never);

    await expect(tracker.read()).resolves.toBeUndefined();
  });

  it('should return undefined, when the document exists but has never been seeded', async () => {
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
