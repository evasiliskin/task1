import { Inject, Injectable } from '@nestjs/common';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from '../processing-log-collection.provider.js';
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { getStats, type IStatsResult } from './get-stats.js';
import { StatsMetricsReader } from './stats-metrics-reader.service.js';

@Injectable()
export class StatsService extends LoggerAware {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
    private readonly metricsReader: StatsMetricsReader,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public getStats(importId?: string): Promise<IStatsResult> {
    return getStats(this.collection, this.metricsReader, importId, this.logger);
  }
}
