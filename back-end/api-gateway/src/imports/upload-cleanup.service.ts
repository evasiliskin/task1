import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { isFinalArchiveFile, isUploadTemporaryFile } from '@task1/shared/storage/archive-paths';

import storageConfig, { type StorageConfiguration } from '../config/storage.config.js';

const SWEPT_LOG = 'Removed orphaned uploaded archives past their retention window';
const SWEEP_FAILED_LOG = 'Could not sweep the archive storage directory';

/**
 * Collects uploaded archives nobody will process.
 *
 * service-a deletes an uploaded archive after a *successful* import, and deliberately keeps it when
 * the import failed. Add a failed publish and a duplicate-claim short-circuit, and the volume grows
 * without bound — up to the 512 MiB upload cap per orphan, on a disk all three services share.
 *
 * The window must outlive a full retry cycle: an upload import gets five retries with exponential
 * backoff, so deleting after minutes would break the last attempt. It sweeps only what the gateway
 * writes — service-a's `.download.tmp` files belong to service-a.
 */
@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(UploadCleanupService.name);
  }

  public async onModuleInit(): Promise<void> {
    await this.requestContextService.runAsRoot('upload-storage-sweep', () => this.sweep());

    this.timer = setInterval(() => {
      this.requestContextService
        .runAsRoot('upload-storage-sweep', () => this.sweep())
        .catch(() => undefined);
    }, this.storageConfiguration.uploadSweepIntervalMs);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed so a test can assert the timer was released rather than reaching into the instance. */
  public hasScheduledSweep(): boolean {
    return this.timer !== undefined;
  }

  private readonly logger: AppLogger;

  private timer?: NodeJS.Timeout;

  private async sweep(): Promise<void> {
    let entries: string[];

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the directory comes from validated env config, not external input.
      entries = await readdir(this.storageConfiguration.dir);
    } catch (error) {
      this.logger.warn({}, SWEEP_FAILED_LOG, error);

      return;
    }

    const cutoff = Date.now() - this.storageConfiguration.uploadRetentionMs;
    const owned = entries.filter(
      (entry) => isUploadTemporaryFile(entry) || isFinalArchiveFile(entry),
    );
    let removed = 0;

    for (const entry of owned) {
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
