import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from '../processing-log-collection.provider.js';
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { type SearchLogsMessage } from './search-logs-message.schema.js';
import { searchLogs, type SearchLogsResult } from './search-logs.js';

@Injectable()
export class LogsSearchService {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
  ) {}

  public search(message: SearchLogsMessage): Promise<SearchLogsResult> {
    return searchLogs(this.collection, message);
  }
}
