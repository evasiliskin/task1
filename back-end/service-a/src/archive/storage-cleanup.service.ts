import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { isDownloadTemporaryFile } from '@task1/shared/storage/archive-paths';

import archiveConfig, { type ArchiveConfiguration } from '../config/archive.config.js';
import storageConfig, { type StorageConfiguration } from '../config/storage.config.js';

const SWEPT_LOG = 'Removed stale temporary archive files left by an interrupted download';
const SWEEP_FAILED_LOG = 'Could not sweep the archive storage directory';

/**
 * Removes download temp files an interrupted run left behind.
 *
 * Scoped twice, deliberately. By **suffix**, because `STORAGE_DIR` is shared with the api-gateway
 * and a bare `.tmp` match deleted the gateway's in-flight multer uploads. By **age**, because a
 * restarting replica must not delete a temp file another replica is still streaming into — a
 * download cannot legitimately outlive `downloadTotalTimeoutMs`.
 */
@Injectable()
export class StorageCleanupService implements OnModuleInit {
  public constructor(
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
    @Inject(archiveConfig.KEY) private readonly archiveConfiguration: ArchiveConfiguration,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(StorageCleanupService.name);
  }

  public async onModuleInit(): Promise<void> {
    await this.requestContextService.runAsRoot('archive-storage-sweep', () => this.sweep());
  }

  private readonly logger: AppLogger;

  private async sweep(): Promise<void> {
    let entries: string[];

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the directory comes from validated env config, not external input.
      entries = await readdir(this.storageConfiguration.dir);
    } catch (error) {
      this.logger.warn({}, SWEEP_FAILED_LOG, error);

      return;
    }

    const cutoff = Date.now() - this.archiveConfiguration.downloadTotalTimeoutMs;
    let removed = 0;

    for (const entry of entries.filter((candidate) => isDownloadTemporaryFile(candidate))) {
      if (await this.removeIfOlderThan(join(this.storageConfiguration.dir, entry), cutoff)) {
        removed += 1;
      }
    }

    if (removed > 0) {
      this.logger.info({ count: removed }, SWEPT_LOG);
    }
  }

  private async removeIfOlderThan(path: string, cutoff: number): Promise<boolean> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from validated env config and a name read out of that same directory.
      const stats = await stat(path);

      if (stats.mtimeMs >= cutoff) {
        return false;
      }

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from validated env config and a filename read out of that same directory.
      await unlink(path);

      return true;
    } catch {
      return false;
    }
  }
}
