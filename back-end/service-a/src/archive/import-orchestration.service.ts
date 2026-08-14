import { Inject, Injectable } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';

import { MetricsService } from '../infra/redis/metrics.service.js';

import { ArchiveDownloadService } from './download/archive-download.service.js';
import { importArchive, type IImportArchiveDependencies } from './import-archive.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { type ImportResult } from './processing/process-archive.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';

const EMIT_FAILED_LOG = 'Failed to publish lifecycle event';

@Injectable()
export class ImportOrchestrationService {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly metricsService: MetricsService,
    private readonly importRunTracker: ImportRunTracker,
    private readonly archiveDownloadService: ArchiveDownloadService,
    private readonly archiveProcessingService: ArchiveProcessingService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('ImportOrchestrationService');
  }

  public importDownload(
    dateHour: string,
    importId: string,
    correlationId: string,
  ): Promise<ImportResult> {
    return importArchive(
      { type: 'download', dateHour },
      importId,
      correlationId,
      this.buildDependencies(),
    );
  }

  public importUpload(
    filePath: string,
    importId: string,
    correlationId: string,
  ): Promise<ImportResult> {
    return importArchive(
      { type: 'upload', filePath },
      importId,
      correlationId,
      this.buildDependencies(),
    );
  }

  private readonly logger: AppLogger;

  private buildDependencies(): IImportArchiveDependencies {
    return {
      downloadArchive: (dateHour) => this.archiveDownloadService.download(dateHour),
      processArchive: (filePath, importId) =>
        this.archiveProcessingService.process(filePath, importId),
      emitEvent: (pattern, payload) => {
        this.serviceBClient.emit(pattern, payload).subscribe({
          error: (error: unknown) => {
            this.logger.warn(
              { pattern, error: error instanceof Error ? error.message : String(error) },
              EMIT_FAILED_LOG,
            );
          },
        });
      },
      recordMetric: (key, value) => this.metricsService.recordMetric(key, value),
      recordImportStarted: (importId, source, startedAt) =>
        this.importRunTracker.recordStarted(importId, source, startedAt),
      recordImportCompleted: (importId, result, completedAt) =>
        this.importRunTracker.recordCompleted(importId, result, completedAt),
      recordImportFailed: (importId, reason, failedAt) =>
        this.importRunTracker.recordFailed(importId, reason, failedAt),
    };
  }
}
