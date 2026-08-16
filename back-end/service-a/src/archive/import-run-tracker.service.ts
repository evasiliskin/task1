import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DUPLICATE_KEY_ERROR_CODE } from '@task1/shared/mongo/duplicate-key.const';
import { type Collection, MongoServerError } from 'mongodb';

import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { type IImportRunDocument, type ImportSourceRecord } from './import-run.types.js';
import { IMPORTS_COLLECTION } from './imports-collection.provider.js';
import { type ImportResult } from './processing/process-archive.js';

const ERROR_SAMPLE_MAX_LENGTH = 500;
const ERROR_SAMPLES_LIMIT = 5;

@Injectable()
export class ImportRunTracker {
  public constructor(
    @Inject(IMPORTS_COLLECTION) private readonly collection: Collection<IImportRunDocument>,
  ) {}

  /**
   * A row can exist before it has started: `claim()` reserves an importId/idempotencyKey pair with
   * only `claimedAt` set, before the download/upload message is ever consumed. Excluding those rows
   * here keeps this method — and everything built on it, like `/imports/{id}` — reporting "no run
   * yet" for a claimed-but-not-started id exactly as it did before claim rows existed, instead of
   * surfacing a partially-populated document that `toImportStatusView` cannot render.
   */
  public async findByImportId(importId: string): Promise<IImportRunDocument | null> {
    return await this.collection.findOne(
      { importId, startedAt: { $exists: true } },
      { projection: { _id: 0 } },
    );
  }

  /**
   * Reserves an importId for an Idempotency-Key, or returns the one already reserved.
   *
   * The key is the client's; the importId is ours. Keeping them separate is what stops a caller
   * choosing the collection's primary key — and `$setOnInsert` makes the reservation atomic, so two
   * concurrent replays of the same key converge on one run.
   */
  public async claim(idempotencyKey: string): Promise<{ importId: string }> {
    const candidateImportId = randomUUID();

    const document = await this.collection.findOneAndUpdate(
      { idempotencyKey },
      { $setOnInsert: { importId: candidateImportId, idempotencyKey, claimedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );

    return { importId: document?.importId ?? candidateImportId };
  }

  public async recordStarted(
    importId: string,
    source: ImportSourceRecord,
    startedAt: Date,
  ): Promise<void> {
    try {
      // Upsert filtered on `startedAt` being absent, not a plain insert: a run reserved by `claim`
      // already exists as a row, and an insert would report every claimed import as a duplicate. A
      // run that has already started fails the filter, attempts an insert, and collides on the
      // unique `importId` — which is still exactly the duplicate-delivery signal.
      await this.collection.updateOne(
        { importId, startedAt: { $exists: false } },
        { $set: { importId, source, status: 'started', startedAt } },
        { upsert: true },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY_ERROR_CODE) {
        throw new ImportAlreadyClaimedError(importId);
      }

      throw error;
    }
  }

  public async recordCompleted(
    importId: string,
    result: ImportResult,
    completedAt: Date,
  ): Promise<void> {
    await this.collection.updateOne(
      { importId },
      { $set: { status: 'completed', completedAt, ...result } },
    );
  }

  public async recordFailed(importId: string, reason: string, failedAt: Date): Promise<void> {
    await this.collection.updateOne(
      { importId },
      {
        $set: { status: 'failed', failedAt },
        $push: {
          errorSamples: {
            $each: [reason.slice(0, ERROR_SAMPLE_MAX_LENGTH)],
            $slice: -ERROR_SAMPLES_LIMIT,
          },
        },
      },
    );
  }

  /**
   * Marks runs abandoned in `started` as failed.
   *
   * A SIGKILL, an OOM or a drain timeout leaves the document `started` with no `failedAt` and
   * nothing to ever correct it, so `/imports/{id}` reports an import as running indefinitely.
   */
  public async failStaleRuns(olderThan: Date, reason: string): Promise<number> {
    const result = await this.collection.updateMany(
      { status: 'started', startedAt: { $lt: olderThan } },
      {
        $set: { status: 'failed', failedAt: new Date() },
        $push: {
          errorSamples: {
            $each: [reason.slice(0, ERROR_SAMPLE_MAX_LENGTH)],
            $slice: -ERROR_SAMPLES_LIMIT,
          },
        },
      },
    );

    return result.modifiedCount;
  }

  /**
   * Deletes reservations `claim()` made that were never started.
   *
   * A claim-only row is not a correctness bug on its own — service-a's `recordStarted` upsert and
   * the gateway's always-publish-on-replay behaviour mean a client retrying the same key still
   * converges on one run (see the Phase 6 plan's "how F16 preserves the idempotency contract" design
   * note). But a client that claims a key and never retries at all leaves a row with no `status`
   * that `failStaleRuns` above can never match — it only looks at `status: 'started'`. Left alone
   * that grows the collection without bound and without observability. There is nothing to "fail":
   * the run never started, so deleting the reservation is correct, and the idempotencyKey becomes
   * free for a genuinely new claim.
   */
  public async expireStaleClaims(olderThan: Date): Promise<number> {
    const result = await this.collection.deleteMany({
      claimedAt: { $lt: olderThan },
      startedAt: { $exists: false },
    });

    return result.deletedCount;
  }
}
