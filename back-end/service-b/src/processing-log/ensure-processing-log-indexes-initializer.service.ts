import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import mongodbConfig, { type MongodbConfiguration } from '../config/mongodb.config.js';

import {
  ensureProcessingLogIndexes,
  ensureProcessingLogRetentionIndex,
} from './ensure-processing-log-indexes.js';
import { PROCESSING_LOG_COLLECTION } from './processing-log-collection.provider.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

const INDEXES_ENSURED_LOG = 'Ensured processing-logs collection indexes';
const RETENTION_INDEX_FAILED_LOG =
  'Could not apply the processing-log retention index; entries will not expire until it succeeds';

@Injectable()
export class EnsureProcessingLogIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
    @Inject(mongodbConfig.KEY) private readonly mongodbConfiguration: MongodbConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(EnsureProcessingLogIndexesInitializer.name);
  }

  public async onModuleInit(): Promise<void> {
    await ensureProcessingLogIndexes(this.collection);

    this.logger.info({}, INDEXES_ENSURED_LOG);

    await this.applyRetentionIndex();
  }

  private readonly logger: AppLogger;

  private async applyRetentionIndex(): Promise<void> {
    try {
      await ensureProcessingLogRetentionIndex(
        this.collection,
        this.mongodbConfiguration.processingLogRetentionMs,
      );
    } catch (error) {
      this.logger.warn({}, RETENTION_INDEX_FAILED_LOG, error);
    }
  }
}
