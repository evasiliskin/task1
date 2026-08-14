import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';
import { type ImportResult } from './processing/process-archive.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- keeps IGithubEventDocument's import path exercised for consistency with the rest of this module's test files; no direct use here.
type UnusedGithubEventDocument = IGithubEventDocument;

describe('ImportRunTracker', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildTracker(
    findOne: ReturnType<typeof vi.fn>,
    insertOne: ReturnType<typeof vi.fn>,
    updateOne: ReturnType<typeof vi.fn>,
  ): ImportRunTracker {
    const collection = {
      findOne,
      insertOne,
      updateOne,
    } as unknown as Collection<IImportRunDocument>;

    return new ImportRunTracker(collection);
  }

  describe('findByImportId', () => {
    it('should return the matching document, when one exists', async () => {
      const document: IImportRunDocument = {
        importId,
        source: { type: 'download', archive: '2026-08-11-0.json.gz' },
        status: 'started',
        startedAt: new Date('2026-08-11T00:00:00Z'),
      };
      const findOne = vi.fn().mockResolvedValue(document);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      const result = await tracker.findByImportId(importId);

      expect(result).toBe(document);
      expect(findOne).toHaveBeenCalledWith({ importId }, { projection: { _id: 0 } });
    });

    it('should return null, when no document matches', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      await expect(tracker.findByImportId(importId)).resolves.toBeNull();
    });
  });

  describe('recordStarted', () => {
    it('should insert a started document with the given source and startedAt, when called', async () => {
      const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const tracker = buildTracker(vi.fn(), insertOne, vi.fn());
      const startedAt = new Date('2026-08-11T00:00:00Z');
      const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

      await tracker.recordStarted(importId, source, startedAt);

      expect(insertOne).toHaveBeenCalledWith({ importId, source, status: 'started', startedAt });
    });
  });

  describe('recordCompleted', () => {
    it('should set completed status, completedAt, and every result counter, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const completedAt = new Date('2026-08-11T00:05:00Z');
      const result: ImportResult = {
        eventsProcessed: 10,
        validEvents: 8,
        invalidEvents: 1,
        duplicateEvents: 1,
        errorCount: 0,
      };

      await tracker.recordCompleted(importId, result, completedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        { $set: { status: 'completed', completedAt, ...result } },
      );
    });
  });

  describe('recordFailed', () => {
    it('should set failed status and failedAt and push a truncated error sample, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const failedAt = new Date('2026-08-11T00:02:00Z');

      await tracker.recordFailed(importId, 'download failed: 404 Not Found', failedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        {
          $set: { status: 'failed', failedAt },
          $push: { errorSamples: { $each: ['download failed: 404 Not Found'], $slice: -5 } },
        },
      );
    });

    it('should truncate the stored reason to 500 characters, when the reason is longer', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const failedAt = new Date('2026-08-11T00:02:00Z');
      const longReason = 'x'.repeat(600);

      await tracker.recordFailed(importId, longReason, failedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        {
          $set: { status: 'failed', failedAt },
          $push: { errorSamples: { $each: [longReason.slice(0, 500)], $slice: -5 } },
        },
      );
    });
  });
});
