import { type Collection } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';
import { type StatsRollupTracker } from './stats/stats-rollup.tracker.js';

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
    timestamp: new Date('2026-08-11T00:00:00.000Z'),
    correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
    archive: '2026-08-11-0.json.gz',
    metadata,
  };
}

describe('ProcessingLogTracker', () => {
  function buildTracker(options: {
    findOneAndUpdate?: ReturnType<typeof vi.fn>;
    updateOne?: ReturnType<typeof vi.fn>;
    applyEntry?: ReturnType<typeof vi.fn>;
  }): {
    tracker: ProcessingLogTracker;
    findOneAndUpdate: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
    applyEntry: ReturnType<typeof vi.fn>;
  } {
    const findOneAndUpdate = options.findOneAndUpdate ?? vi.fn().mockResolvedValue(null);
    const updateOne = options.updateOne ?? vi.fn().mockResolvedValue({ acknowledged: true });
    const applyEntry = options.applyEntry ?? vi.fn().mockResolvedValue(undefined);
    const collection = {
      findOneAndUpdate,
      updateOne,
    } as unknown as Collection<IProcessingLogDocument>;
    const statsRollup = { applyEntry } as unknown as StatsRollupTracker;

    return {
      tracker: new ProcessingLogTracker(collection, statsRollup),
      findOneAndUpdate,
      updateOne,
      applyEntry,
    };
  }

  describe('upsertLog', () => {
    it('should upsert keyed by importId and status, when called', async () => {
      const entry = buildEntry('started');
      const { tracker, findOneAndUpdate } = buildTracker({});

      await tracker.upsertLog(entry);

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { importId: entry.importId, status: entry.status },
        { $set: entry },
        { upsert: true, returnDocument: 'after' },
      );
    });

    it('should apply the rollup delta and only then stamp rolledUpAt, when the entry has never been rolled up', async () => {
      const entry = buildEntry('completed', { eventsProcessed: 10 });
      const applyOrder: string[] = [];
      const applyEntry = vi.fn().mockImplementation(() => {
        applyOrder.push('applyEntry');

        return Promise.resolve(undefined);
      });
      const updateOne = vi.fn().mockImplementation(() => {
        applyOrder.push('stamp');

        return Promise.resolve({ modifiedCount: 1 });
      });
      const { tracker } = buildTracker({ applyEntry, updateOne });

      await tracker.upsertLog(entry);

      expect(applyOrder).toEqual(['applyEntry', 'stamp']);
      expect(applyEntry).toHaveBeenCalledWith(entry);
      expect(updateOne).toHaveBeenCalledWith(
        { importId: entry.importId, status: entry.status },
        { $set: { rolledUpAt: expect.any(Date) as Date } },
      );
    });

    it('should re-apply the rollup delta, when a redelivery finds the increment was never stamped', async () => {
      const entry = buildEntry('completed', { eventsProcessed: 10 });
      const { tracker, applyEntry } = buildTracker({
        findOneAndUpdate: vi.fn().mockResolvedValue({ ...entry }),
      });

      await tracker.upsertLog(entry);

      expect(applyEntry).toHaveBeenCalledWith(entry);
    });

    it('should skip the rollup delta, when the entry is already stamped as rolled up', async () => {
      const entry = buildEntry('completed', { eventsProcessed: 10 });
      const { tracker, applyEntry, updateOne } = buildTracker({
        findOneAndUpdate: vi
          .fn()
          .mockResolvedValue({ ...entry, rolledUpAt: new Date('2026-08-11T01:00:00.000Z') }),
      });

      await tracker.upsertLog(entry);

      expect(applyEntry).not.toHaveBeenCalled();
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('should not stamp rolledUpAt and should rethrow, when the increment fails', async () => {
      const failure = new Error('transient mongo error');
      const { tracker, updateOne } = buildTracker({
        applyEntry: vi.fn().mockRejectedValue(failure),
      });

      await expect(tracker.upsertLog(buildEntry('completed'))).rejects.toThrow(failure);

      expect(updateOne).not.toHaveBeenCalled();
    });

    it('should rethrow the original failure, when the log upsert itself fails', async () => {
      const failure = new Error('mongo down');
      const { tracker, applyEntry } = buildTracker({
        findOneAndUpdate: vi.fn().mockRejectedValue(failure),
      });

      await expect(tracker.upsertLog(buildEntry('completed'))).rejects.toThrow(failure);

      expect(applyEntry).not.toHaveBeenCalled();
    });
  });
});
