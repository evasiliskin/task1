import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import mongodbConfig from '../../config/mongodb.config.js';
import { EVENTS_COLLECTION } from '../events-collection.provider.js';
import { type ImportResult, processArchive } from '../processing/process-archive.js';

const INVALID_LINE_LOG_MESSAGE = 'Skipped invalid archive line';

@Injectable()
export class ArchiveProcessingService extends LoggerAware {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    @Inject(mongodbConfig.KEY)
    private readonly mongodbConfiguration: ConfigType<typeof mongodbConfig>,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public process(filePath: string, importId: string): Promise<ImportResult> {
    return processArchive(
      filePath,
      importId,
      { collection: this.collection, batchSize: this.mongodbConfiguration.batchSize },
      (rawLine, error) => {
        this.logger.warn({ importId, rawLine }, INVALID_LINE_LOG_MESSAGE, error);
      },
    );
  }
}
