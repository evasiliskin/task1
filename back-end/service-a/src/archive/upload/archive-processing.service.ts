import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import mongodbConfig from '../../config/mongodb.config.js';
import { EVENTS_COLLECTION } from '../events-collection.provider.js';
import { type ImportResult, processArchive } from '../processing/process-archive.js';

const INVALID_LINE_LOG_MESSAGE = 'Skipped invalid archive line';
const MAX_INVALID_LINE_LOGS = 10;
const RAW_LINE_PREVIEW_LENGTH = 200;

@Injectable()
export class ArchiveProcessingService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    @Inject(mongodbConfig.KEY)
    private readonly mongodbConfiguration: ConfigType<typeof mongodbConfig>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ArchiveProcessingService.name);
  }

  public process(filePath: string, importId: string): Promise<ImportResult> {
    // A drifted or truncated archive invalidates every line. Without a cap, one bad import emits
    // hundreds of thousands of warnings carrying full raw JSON — enough to evict real logs from
    // retention. The total still reaches the caller as `invalidEvents`, which is the number worth
    // alerting on.
    let loggedCount = 0;

    return processArchive(
      filePath,
      importId,
      { collection: this.collection, batchSize: this.mongodbConfiguration.batchSize },
      (rawLine, error) => {
        if (loggedCount >= MAX_INVALID_LINE_LOGS) {
          return;
        }

        loggedCount += 1;

        this.logger.warn(
          {
            importId,
            rawLinePreview: rawLine.slice(0, RAW_LINE_PREVIEW_LENGTH),
            suppressingFurtherLines: loggedCount === MAX_INVALID_LINE_LOGS,
          },
          INVALID_LINE_LOG_MESSAGE,
          error,
        );
      },
    );
  }

  private readonly logger: AppLogger;
}
