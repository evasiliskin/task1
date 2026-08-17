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

  public async findByImportId(importId: string): Promise<IImportRunDocument | null> {
    return await this.collection.findOne(
      { importId, startedAt: { $exists: true } },
      { projection: { _id: 0 } },
    );
  }

  public async claim(idempotencyKey: string): Promise<{ importId: string }> {
    const candidateImportId = randomUUID();

    try {
      const document = await this.collection.findOneAndUpdate(
        { idempotencyKey },
        { $setOnInsert: { importId: candidateImportId, idempotencyKey, claimedAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      );

      return { importId: document?.importId ?? candidateImportId };
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== DUPLICATE_KEY_ERROR_CODE) {
        throw error;
      }

      return await this.readClaimedImportId(idempotencyKey, error);
    }
  }

  public async recordStarted(
    importId: string,
    source: ImportSourceRecord,
    startedAt: Date,
    isRetry = false,
  ): Promise<void> {
    const filter = isRetry ? { importId } : { importId, startedAt: { $exists: false } };

    try {
      await this.collection.updateOne(
        filter,
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

  public async expireStaleClaims(olderThan: Date): Promise<number> {
    const result = await this.collection.deleteMany({
      claimedAt: { $lt: olderThan },
      startedAt: { $exists: false },
    });

    return result.deletedCount;
  }

  private async readClaimedImportId(
    idempotencyKey: string,
    duplicateKeyError: MongoServerError,
  ): Promise<{ importId: string }> {
    const existing = await this.collection.findOne(
      { idempotencyKey },
      { projection: { _id: 0, importId: 1 } },
    );

    if (existing === null) {
      throw duplicateKeyError;
    }

    return { importId: existing.importId };
  }
}
