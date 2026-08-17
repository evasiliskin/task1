import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { MongoServerError } from 'mongodb';
import { type Collection } from 'mongodb';

import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';
import { type ImportResult } from './processing/process-archive.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- keeps IGithubEventDocument's import path exercised for consistency with the rest of this module's test files; no direct use here.
type UnusedGithubEventDocument = IGithubEventDocument;

const SOURCE = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };
const STARTED_AT = new Date('2026-08-11T00:00:00Z');

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
      expect(findOne).toHaveBeenCalledWith(
        { importId, startedAt: { $exists: true } },
        { projection: { _id: 0 } },
      );
    });

    it('should return null, when no document matches', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      await expect(tracker.findByImportId(importId)).resolves.toBeNull();
    });

    it('should exclude the run, when it is a claim-only reservation with no startedAt', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      await tracker.findByImportId(importId);

      expect(findOne).toHaveBeenCalledWith(
        { importId, startedAt: { $exists: true } },
        { projection: { _id: 0 } },
      );
    });

    it('should return null, when the only matching document is a claim-only reservation with no startedAt', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      await expect(tracker.findByImportId(importId)).resolves.toBeNull();
    });

    it('should return the document, when it has startedAt set', async () => {
      const document: IImportRunDocument = {
        importId,
        source: { type: 'download', archive: '2026-08-11-0.json.gz' },
        status: 'started',
        startedAt: new Date('2026-08-11T00:00:00Z'),
      };
      const findOne = vi.fn().mockResolvedValue(document);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      await expect(tracker.findByImportId(importId)).resolves.toBe(document);
    });
  });

  describe('recordStarted', () => {
    it('should upsert a started document filtered on startedAt being absent, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const startedAt = new Date('2026-08-11T00:00:00Z');
      const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

      await tracker.recordStarted(importId, source, startedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId, startedAt: { $exists: false } },
        { $set: { importId, source, status: 'started', startedAt } },
        { upsert: true },
      );
    });

    it('should start the run, when it was previously only claimed', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });
      const tracker = new ImportRunTracker({ updateOne } as never);

      await expect(
        tracker.recordStarted('11111111-1111-4111-8111-111111111111', SOURCE, STARTED_AT),
      ).resolves.toBeUndefined();
      expect(updateOne).toHaveBeenCalledWith(
        { importId: '11111111-1111-4111-8111-111111111111', startedAt: { $exists: false } },
        { $set: expect.objectContaining({ status: 'started' }) as unknown },
        { upsert: true },
      );
    });

    it('should restart the run without the startedAt guard, when the delivery is a retry', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);

      await tracker.recordStarted(importId, SOURCE, STARTED_AT, true);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        { $set: { importId, source: SOURCE, status: 'started', startedAt: STARTED_AT } },
        { upsert: true },
      );
    });

    it('should throw ImportAlreadyClaimedError, when the run has already started', async () => {
      const duplicate = Object.assign(new MongoServerError({ message: 'dup' }), { code: 11_000 });
      const tracker = new ImportRunTracker({
        updateOne: vi.fn().mockRejectedValue(duplicate),
      } as never);

      await expect(
        tracker.recordStarted('11111111-1111-4111-8111-111111111111', SOURCE, STARTED_AT),
      ).rejects.toBeInstanceOf(ImportAlreadyClaimedError);
    });
  });

  describe('claim', () => {
    it('should reserve a run, when the idempotency key is new', async () => {
      const findOneAndUpdate = vi.fn().mockResolvedValue({
        importId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'k',
      });
      const tracker = new ImportRunTracker({ findOneAndUpdate } as never);

      await expect(tracker.claim('k')).resolves.toEqual({
        importId: '11111111-1111-4111-8111-111111111111',
      });
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { idempotencyKey: 'k' },
        { $setOnInsert: expect.objectContaining({ idempotencyKey: 'k' }) as unknown },
        { upsert: true, returnDocument: 'after' },
      );
    });

    it('should return the same importId, when the idempotency key is replayed', async () => {
      const existing = { importId: 'e2d5a7c4-1b83-4f60-9a2e-7c5b4d1f8a03', idempotencyKey: 'k' };
      const tracker = new ImportRunTracker({
        findOneAndUpdate: vi.fn().mockResolvedValue(existing),
      } as never);

      const first = await tracker.claim('k');
      const second = await tracker.claim('k');

      expect(second).toEqual(first);
    });

    it('should resolve to the winning importId, when a concurrent claim raises a duplicate key error', async () => {
      const duplicate = Object.assign(new MongoServerError({ message: 'dup' }), { code: 11_000 });
      const findOne = vi
        .fn()
        .mockResolvedValue({ importId: 'e2d5a7c4-1b83-4f60-9a2e-7c5b4d1f8a03' });
      const tracker = new ImportRunTracker({
        findOneAndUpdate: vi.fn().mockRejectedValue(duplicate),
        findOne,
      } as never);

      await expect(tracker.claim('k')).resolves.toEqual({
        importId: 'e2d5a7c4-1b83-4f60-9a2e-7c5b4d1f8a03',
      });
      expect(findOne).toHaveBeenCalledWith(
        { idempotencyKey: 'k' },
        { projection: { _id: 0, importId: 1 } },
      );
    });

    it('should rethrow the duplicate key error, when the conflicting claim cannot be read back', async () => {
      const duplicate = Object.assign(new MongoServerError({ message: 'dup' }), { code: 11_000 });
      const tracker = new ImportRunTracker({
        findOneAndUpdate: vi.fn().mockRejectedValue(duplicate),
        findOne: vi.fn().mockResolvedValue(null),
      } as never);

      await expect(tracker.claim('k')).rejects.toBe(duplicate);
    });

    it('should rethrow, when findOneAndUpdate fails for an unrelated reason', async () => {
      const failure = new Error('connection reset');
      const tracker = new ImportRunTracker({
        findOneAndUpdate: vi.fn().mockRejectedValue(failure),
      } as never);

      await expect(tracker.claim('k')).rejects.toBe(failure);
    });

    it('should return an importId distinct from the key, when a run is reserved', async () => {
      const tracker = new ImportRunTracker({
        findOneAndUpdate: vi
          .fn()
          .mockImplementation((_filter, update: { $setOnInsert: { importId: string } }) =>
            Promise.resolve({ importId: update.$setOnInsert.importId }),
          ),
      } as never);

      const key = '22222222-2222-4222-8222-222222222222';

      expect((await tracker.claim(key)).importId).not.toBe(key);
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
    it('should fail the runs, when they were left started before the cutoff', async () => {
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

  describe('expireStaleClaims', () => {
    it('should delete the rows, when they are claim-only and older than the cutoff', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 3 });
      const tracker = new ImportRunTracker({ deleteMany } as never);
      const cutoff = new Date('2026-08-11T00:00:00Z');

      await expect(tracker.expireStaleClaims(cutoff)).resolves.toBe(3);
      expect(deleteMany).toHaveBeenCalledWith({
        claimedAt: { $lt: cutoff },
        startedAt: { $exists: false },
      });
    });

    it('should return 0, when nothing is stale', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 0 });
      const tracker = new ImportRunTracker({ deleteMany } as never);

      await expect(tracker.expireStaleClaims(new Date())).resolves.toBe(0);
    });
  });

  describe('recordStarted duplicate handling', () => {
    it('should throw ImportAlreadyClaimedError, when the unique importId index rejects the upsert', async () => {
      const duplicateKeyError = new MongoServerError({ message: 'E11000 duplicate key' });
      duplicateKeyError.code = 11_000;

      const collection = {
        updateOne: vi.fn().mockRejectedValue(duplicateKeyError),
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

    it('should rethrow the original error, when the upsert fails for any reason other than a duplicate key', async () => {
      const collection = {
        updateOne: vi.fn().mockRejectedValue(new Error('connection reset')),
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
