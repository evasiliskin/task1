import { unlink } from 'node:fs/promises';

import { Inject, Injectable } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';

import { MetricsService } from '../infra/redis/metrics.service.js';

import { ArchiveDownloadService } from './download/archive-download.service.js';
import { importArchive, type IImportArchiveDependencies } from './import-archive.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { InFlightImportRegistry } from './in-flight-import.registry.js';
import { type ImportResult } from './processing/process-archive.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';

const EMIT_FAILED_LOG = 'Failed to publish lifecycle event';
const DELETE_FAILED_LOG = 'Failed to delete processed archive';

@Injectable()
export class ImportOrchestrationService {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly metricsService: MetricsService,
    private readonly importRunTracker: ImportRunTracker,
    private readonly archiveDownloadService: ArchiveDownloadService,
    private readonly archiveProcessingService: ArchiveProcessingService,
    private readonly propagatingClient: ContextPropagatingClient,
    private readonly inFlightImports: InFlightImportRegistry,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ImportOrchestrationService.name);
    // Nothing in the dependency set varies per import, so it is a constant of this service rather
    // than an eleven-member object re-allocated on every call.
    this.dependencies = this.buildDependencies();
  }

  public importDownload(dateHour: string, importId: string): Promise<ImportResult> {
    return this.inFlightImports.track(() =>
      importArchive({ type: 'download', dateHour }, importId, this.dependencies),
    );
  }

  public importUpload(filePath: string, importId: string): Promise<ImportResult> {
    return this.inFlightImports.track(() =>
      importArchive({ type: 'upload', filePath }, importId, this.dependencies),
    );
  }

  private readonly logger: AppLogger;

  private readonly dependencies: IImportArchiveDependencies;

  private buildDependencies(): IImportArchiveDependencies {
    return {
      downloadArchive: (dateHour, importId) =>
        this.archiveDownloadService.download(dateHour, importId),
      processArchive: (filePath, importId) =>
        this.archiveProcessingService.process(filePath, importId),
      emitEvent: (pattern, payload) => {
        this.propagatingClient.emit(this.serviceBClient, pattern, payload).subscribe({
          error: (error: unknown) => {
            this.logger.warn({ pattern }, EMIT_FAILED_LOG, error);
          },
        });
      },
      recordMetric: (key, value) => this.metricsService.recordMetric(key, value),
      recordMetrics: (entries) => this.metricsService.recordMetrics(entries),
      recordImportStarted: (importId, source, startedAt) =>
        this.importRunTracker.recordStarted(importId, source, startedAt),
      recordImportCompleted: (importId, result, completedAt) =>
        this.importRunTracker.recordCompleted(importId, result, completedAt),
      recordImportFailed: (importId, reason, failedAt) =>
        this.importRunTracker.recordFailed(importId, reason, failedAt),
      deleteArchive: (filePath) => this.deleteArchive(filePath),
      logger: this.logger,
    };
  }

  private async deleteArchive(filePath: string): Promise<void> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is the storage path this service just wrote or was handed by the gateway's validated upload flow, never raw external input.
      await unlink(filePath);
    } catch (error) {
      this.logger.warn({ filePath }, DELETE_FAILED_LOG, error);
    }
  }
}
