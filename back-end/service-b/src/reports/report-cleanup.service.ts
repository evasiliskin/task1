import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';

import reportConfig, { type ReportConfiguration } from '../config/report.config.js';

const PDF_SUFFIX = '.pdf';
const SWEPT_LOG = 'Removed orphaned report files past their retention window';
const SWEEP_FAILED_LOG = 'Could not sweep the report directory';

@Injectable()
export class ReportCleanupService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(reportConfig.KEY) private readonly reportConfiguration: ReportConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('ReportCleanupService');
  }

  public async onModuleInit(): Promise<void> {
    await this.sweep();

    this.timer = setInterval(() => {
      this.sweep().catch(() => undefined);
    }, this.reportConfiguration.sweepIntervalMs);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private readonly logger: AppLogger;

  private timer?: NodeJS.Timeout;

  private async sweep(): Promise<void> {
    let entries: string[];

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the directory comes from validated env config, not external input.
      entries = await readdir(this.reportConfiguration.dir);
    } catch (error) {
      this.logger.warn({}, SWEEP_FAILED_LOG, error);

      return;
    }

    const cutoff = Date.now() - this.reportConfiguration.retentionMs;
    let removed = 0;

    for (const entry of entries.filter((candidate) => candidate.endsWith(PDF_SUFFIX))) {
      const path = join(this.reportConfiguration.dir, entry);

      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
        const stats = await stat(path);

        if (stats.mtimeMs < cutoff) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
          await unlink(path);
          removed += 1;
        }
      } catch {
        continue;
      }
    }

    if (removed > 0) {
      this.logger.info({ count: removed }, SWEPT_LOG);
    }
  }
}
