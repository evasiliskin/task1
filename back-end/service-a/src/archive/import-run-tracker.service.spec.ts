import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { MongoServerError } from 'mongodb';
import { type Collection } from 'mongodb';

import { ImportAlreadyClaimedError } from './import-claim.error.js';
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

  describe('failStaleRuns', () => {
    it('should fail every run left started before the cutoff', async () => {
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
      const tracker = new ImportRunTracker({ updateMany } as never);
      const cutoff = new Date('2026-08-11T00:00:00Z');

      await expect(tracker.failStaleRuns(cutoff, 'abandoned')).resolves.toBe(2);
      expect(updateMany).toHaveBeenCalledWith(
        { status: 'started', startedAt: { $lt: cutoff } },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining()'s return type is untyped `any` by design; this asserts against a vi.fn() mock call, not production code.
        expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      );
    });
  });

  describe('recordStarted duplicate handling', () => {
    it('should throw ImportAlreadyClaimedError, when the unique importId index rejects the insert', async () => {
      const duplicateKeyError = new MongoServerError({ message: 'E11000 duplicate key' });
      duplicateKeyError.code = 11_000;

      const collection = {
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError),
      } as unknown as Collection<IImportRunDocument>;
      const tracker = new ImportRunTracker(collection);

      await expect(
        tracker.recordStarted(
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          { type: 'download', archive: 'x.json.gz' },
          new Date(),
        ),
      ).rejects.toBeInstanceOf(ImportAlreadyClaimedError);
    });

    it('should rethrow the original error, when the insert fails for any reason other than a duplicate key', async () => {
      const collection = {
        insertOne: vi.fn().mockRejectedValue(new Error('connection reset')),
      } as unknown as Collection<IImportRunDocument>;
      const tracker = new ImportRunTracker(collection);

      await expect(
        tracker.recordStarted(
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          { type: 'download', archive: 'x.json.gz' },
          new Date(),
        ),
      ).rejects.toThrow('connection reset');
    });
  });
});
