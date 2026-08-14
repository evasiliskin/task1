import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';

import storageConfig, { type StorageConfiguration } from '../config/storage.config.js';

const TEMP_SUFFIX = '.tmp';
const SWEPT_LOG = 'Removed stale temporary archive files left by an interrupted download';
const SWEEP_FAILED_LOG = 'Could not sweep the archive storage directory';

@Injectable()
export class StorageCleanupService extends LoggerAware implements OnModuleInit {
  public constructor(
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public async onModuleInit(): Promise<void> {
    let entries: string[];

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the directory comes from validated env config, not external input.
      entries = await readdir(this.storageConfiguration.dir);
    } catch (error) {
      this.logger.warn({}, SWEEP_FAILED_LOG, error);

      return;
    }

    const staleFiles = entries.filter((entry) => entry.endsWith(TEMP_SUFFIX));

    for (const staleFile of staleFiles) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      await unlink(join(this.storageConfiguration.dir, staleFile)).catch(() => undefined);
    }

    if (staleFiles.length > 0) {
      this.logger.info({ count: staleFiles.length }, SWEPT_LOG);
    }
  }
}
