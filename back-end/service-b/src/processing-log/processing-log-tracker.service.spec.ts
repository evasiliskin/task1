import { type Collection } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';
import { type StatsRollupTracker } from './stats/stats-rollup.tracker.js';

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

describe('ProcessingLogTracker', () => {
  const entry: IProcessingLogDocument = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    eventType: 'github.import.started',
    service: 'service-a',
    status: 'started',
    timestamp: new Date('2026-08-11T00:00:00.000Z'),
    correlationId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    archive: '2026-08-11-0.json.gz',
    metadata: {},
  };

  function buildTracker(options: {
    updateOne?: ReturnType<typeof vi.fn>;
    applyEntry?: ReturnType<typeof vi.fn>;
  }): {
    tracker: ProcessingLogTracker;
    updateOne: ReturnType<typeof vi.fn>;
    applyEntry: ReturnType<typeof vi.fn>;
  } {
    const updateOne = options.updateOne ?? vi.fn().mockResolvedValue({ acknowledged: true });
    const applyEntry = options.applyEntry ?? vi.fn().mockResolvedValue(undefined);
    const collection = { updateOne } as unknown as Collection<IProcessingLogDocument>;
    const statsRollup = { applyEntry } as unknown as StatsRollupTracker;

    return { tracker: new ProcessingLogTracker(collection, statsRollup), updateOne, applyEntry };
  }

  describe('upsertLog', () => {
    it('should upsert keyed by importId and status, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const { tracker } = buildTracker({ updateOne });

      await tracker.upsertLog(entry);

      expect(updateOne).toHaveBeenNthCalledWith(
        1,
        { importId: entry.importId, status: entry.status },
        { $set: entry },
        { upsert: true },
      );
    });

    it('should issue the identical upsert, when called twice with the same entry (redelivery is a no-op)', async () => {
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const { tracker } = buildTracker({ updateOne });

      await tracker.upsertLog(entry);
      await tracker.upsertLog(entry);

      const upsertCalls = updateOne.mock.calls.filter(
        (call) => (call[2] as { upsert?: boolean } | undefined)?.upsert === true,
      );

      expect(upsertCalls).toHaveLength(2);
      expect(upsertCalls[0]).toEqual(upsertCalls[1]);
    });

    it('should apply the rollup delta when the claim on rolledUpAt succeeds', async () => {
      const updateOne = vi
        .fn()
        .mockResolvedValueOnce({ modifiedCount: 0 }) // upsert of the log document
        .mockResolvedValueOnce({ modifiedCount: 1 }); // claim of rolledUpAt succeeds
      const applyEntry = vi.fn().mockResolvedValue(undefined);
      const { tracker } = buildTracker({ updateOne, applyEntry });
      const testEntry = buildEntry('completed');

      await tracker.upsertLog(testEntry);

      expect(updateOne).toHaveBeenNthCalledWith(
        2,
        { importId: testEntry.importId, status: testEntry.status, rolledUpAt: { $exists: false } },
        { $set: { rolledUpAt: expect.any(Date) as Date } },
      );
      expect(applyEntry).toHaveBeenCalledWith(testEntry);
      expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it('should not apply the rollup delta when the claim on rolledUpAt fails (already applied)', async () => {
      const updateOne = vi
        .fn()
        .mockResolvedValueOnce({ modifiedCount: 0 }) // upsert of the log document
        .mockResolvedValueOnce({ modifiedCount: 0 }); // claim fails: already rolled up
      const applyEntry = vi.fn();
      const { tracker } = buildTracker({ updateOne, applyEntry });

      await tracker.upsertLog(buildEntry('completed'));

      expect(applyEntry).not.toHaveBeenCalled();
      expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it('should revert the claim and re-throw, when applyEntry fails', async () => {
      const updateOne = vi
        .fn()
        .mockResolvedValueOnce({ modifiedCount: 0 }) // upsert of the log document
        .mockResolvedValueOnce({ modifiedCount: 1 }) // claim succeeds
        .mockResolvedValueOnce({ modifiedCount: 1 }); // revert
      const applyError = new Error('transient mongo error');
      const applyEntry = vi.fn().mockRejectedValue(applyError);
      const { tracker } = buildTracker({ updateOne, applyEntry });
      const testEntry = buildEntry('completed');

      await expect(tracker.upsertLog(testEntry)).rejects.toThrow(applyError);

      expect(updateOne).toHaveBeenNthCalledWith(
        3,
        { importId: testEntry.importId, status: testEntry.status },
        { $unset: { rolledUpAt: '' } },
      );
      expect(updateOne).toHaveBeenCalledTimes(3);
    });
  });
});
