import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

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
    return await this.collection.findOne({ importId });
  }

  public async recordStarted(
    importId: string,
    source: ImportSourceRecord,
    startedAt: Date,
  ): Promise<void> {
    await this.collection.insertOne({ importId, source, status: 'started', startedAt });
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
}
