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
const BATCH_WRITE_ERRORS_LOG_MESSAGE = 'Batch insert reported non-duplicate write errors';
const MAX_BATCH_ERROR_LOGS = 10;

/**
 * A hard cap on how many lines one operation may emit for a repeating condition.
 *
 * Different policy from `LogThrottle`: an import is a bounded operation, so "the first N, then
 * silence" is the right shape — a time window would let a long import emit indefinitely. Returns
 * `undefined` once the cap is passed; otherwise the flag to stamp on the line so the reader knows
 * the log is about to go quiet.
 */
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
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ArchiveProcessingService.name);
  }

  public process(filePath: string, importId: string): Promise<ImportResult> {
    // A drifted or truncated archive invalidates every line. Without a cap, one bad import emits
    // hundreds of thousands of warnings carrying full raw JSON — enough to evict real logs from
    // retention. The totals still reach the caller as `invalidEvents` / `errorCount`, which are
    // the numbers worth alerting on.
    const invalidLineCap = createLogCap(MAX_INVALID_LINE_LOGS);
    const batchErrorCap = createLogCap(MAX_BATCH_ERROR_LOGS);

    return processArchive(
      filePath,
      importId,
      { collection: this.collection, batchSize: this.mongodbConfiguration.batchSize },
      (rawLine, error) => {
        const cap = invalidLineCap();

        if (cap === undefined) {
          return;
        }

        this.logger.warn(
          { importId, rawLinePreview: rawLine.slice(0, RAW_LINE_PREVIEW_LENGTH), ...cap },
          INVALID_LINE_LOG_MESSAGE,
          error,
        );
      },
      (errorCount, errorSample) => {
        const cap = batchErrorCap();

        if (cap === undefined) {
          return;
        }

        this.logger.warn(
          { importId, errorCount, errorSample, ...cap },
          BATCH_WRITE_ERRORS_LOG_MESSAGE,
        );
      },
    );
  }

  private readonly logger: AppLogger;
}
