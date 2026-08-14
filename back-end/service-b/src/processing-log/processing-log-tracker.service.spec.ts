import { type Collection } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

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

  function buildTracker(updateOne: ReturnType<typeof vi.fn>): ProcessingLogTracker {
    const collection = { updateOne } as unknown as Collection<IProcessingLogDocument>;

    return new ProcessingLogTracker(collection);
  }

  describe('upsertLog', () => {
    it('should upsert keyed by importId and status, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const tracker = buildTracker(updateOne);

      await tracker.upsertLog(entry);

      expect(updateOne).toHaveBeenCalledWith(
        { importId: entry.importId, status: entry.status },
        { $set: entry },
        { upsert: true },
      );
    });

    it('should issue the identical upsert, when called twice with the same entry (redelivery is a no-op)', async () => {
      const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const tracker = buildTracker(updateOne);

      await tracker.upsertLog(entry);
      await tracker.upsertLog(entry);

      expect(updateOne).toHaveBeenCalledTimes(2);
      expect(updateOne.mock.calls[0]).toEqual(updateOne.mock.calls[1]);
    });
  });
});
