import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from './processing-log-collection.provider.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

@Injectable()
export class ProcessingLogTracker {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
  ) {}

  public async upsertLog(entry: IProcessingLogDocument): Promise<void> {
    await this.collection.updateOne(
      { importId: entry.importId, status: entry.status },
      { $set: entry },
      { upsert: true },
    );
  }
}
