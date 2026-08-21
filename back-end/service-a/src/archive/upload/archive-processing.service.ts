import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import archiveConfig from '../../config/archive.config.js';
import mongodbConfig from '../../config/mongodb.config.js';
import { EVENTS_COLLECTION } from '../events-collection.provider.js';
import { type OnInvalidLine } from '../processing/parse-and-validate.js';
import {
  type ImportResult,
  type OnBatchErrors,
  processArchive,
} from '../processing/process-archive.js';

const INVALID_LINE_LOG_MESSAGE = 'Skipped invalid archive line';
const MAX_INVALID_LINE_LOGS = 10;
const RAW_LINE_PREVIEW_LENGTH = 200;
const BATCH_WRITE_ERRORS_LOG_MESSAGE = 'Batch insert reported non-duplicate write errors';
const MAX_BATCH_ERROR_LOGS = 10;

function createLogCap(max: number): () => { suppressingFurtherLines: boolean } | undefined {
  let logged = 0;

  return () => {
    if (logged >= max) {
      return undefined;
    }

    logged += 1;

    return { suppressingFurtherLines: logged === max };
  };
}

@Injectable()
export class ArchiveProcessingService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    @Inject(mongodbConfig.KEY)
    private readonly mongodbConfiguration: ConfigType<typeof mongodbConfig>,
    @Inject(archiveConfig.KEY)
    private readonly archiveConfiguration: ConfigType<typeof archiveConfig>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ArchiveProcessingService.name);
  }

  public process(filePath: string, importId: string): Promise<ImportResult> {
    return processArchive(
      filePath,
      importId,
      {
        collection: this.collection,
        batchSize: this.mongodbConfiguration.batchSize,
        insertConcurrency: this.mongodbConfiguration.insertConcurrency,
        maxLineBytes: this.archiveConfiguration.maxLineBytes,
        maxDecompressedBytes: this.archiveConfiguration.maxDecompressedBytes,
      },
      this.buildInvalidLineLogger(importId),
      this.buildBatchErrorLogger(importId),
    );
  }

  private readonly logger: AppLogger;

  private buildInvalidLineLogger(importId: string): OnInvalidLine {
    const cap = createLogCap(MAX_INVALID_LINE_LOGS);

    return (rawLine, error) => {
      const capState = cap();

      if (capState === undefined) {
        return;
      }

      this.logger.warn(
        { importId, rawLinePreview: rawLine.slice(0, RAW_LINE_PREVIEW_LENGTH), ...capState },
        INVALID_LINE_LOG_MESSAGE,
        error,
      );
    };
  }

  private buildBatchErrorLogger(importId: string): OnBatchErrors {
    const cap = createLogCap(MAX_BATCH_ERROR_LOGS);

    return (errorCount, errorSample) => {
      const capState = cap();

      if (capState === undefined) {
        return;
      }

      this.logger.warn(
        { importId, errorCount, errorSample, ...capState },
        BATCH_WRITE_ERRORS_LOG_MESSAGE,
      );
    };
  }
}
