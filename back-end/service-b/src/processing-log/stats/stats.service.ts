import { Inject, Injectable } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from '../processing-log-collection.provider.js';
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { getStats, type IStatsResult } from './get-stats.js';
import { StatsMetricsReader } from './stats-metrics-reader.service.js';

@Injectable()
export class StatsService {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
    private readonly metricsReader: StatsMetricsReader,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(StatsService.name);
  }

  public getStats(importId?: string): Promise<IStatsResult> {
    return getStats(this.collection, this.metricsReader, importId, this.logger);
  }

  private readonly logger: AppLogger;
}
