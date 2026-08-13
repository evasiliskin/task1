import { type ClientProxy } from '@nestjs/microservices';

import { type MetricsService } from '../infra/redis/metrics.service.js';

import { type ArchiveDownloadService } from './download/archive-download.service.js';
import { ImportOrchestrationService } from './import-orchestration.service.js';
import { type ImportRunTracker } from './import-run-tracker.service.js';
import { type ImportResult } from './processing/process-archive.js';
import { type ArchiveProcessingService } from './upload/archive-processing.service.js';

describe('ImportOrchestrationService', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const successfulResult: ImportResult = {
    eventsProcessed: 3,
    validEvents: 3,
    invalidEvents: 0,
    duplicateEvents: 0,
    errorCount: 0,
  };

  function buildService(): {
    service: ImportOrchestrationService;
    emit: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    process: ReturnType<typeof vi.fn>;
    recordMetric: ReturnType<typeof vi.fn>;
    recordImportStarted: ReturnType<typeof vi.fn>;
    recordImportCompleted: ReturnType<typeof vi.fn>;
  } {
    const emit = vi.fn();
    const download = vi.fn().mockResolvedValue({ filePath: '/data/archives/2026-08-11-0.json.gz' });
    const process = vi.fn().mockResolvedValue(successfulResult);
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const recordImportStarted = vi.fn().mockResolvedValue(undefined);
    const recordImportCompleted = vi.fn().mockResolvedValue(undefined);
    const recordImportFailed = vi.fn().mockResolvedValue(undefined);

    const serviceBClient = { emit } as unknown as ClientProxy;
    const metricsService = { recordMetric } as unknown as MetricsService;
    const importRunTracker = {
      recordStarted: recordImportStarted,
      recordCompleted: recordImportCompleted,
      recordFailed: recordImportFailed,
    } as unknown as ImportRunTracker;
    const archiveDownloadService = { download } as unknown as ArchiveDownloadService;
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;

    const service = new ImportOrchestrationService(
      serviceBClient,
      metricsService,
      importRunTracker,
      archiveDownloadService,
      archiveProcessingService,
    );

    return {
      service,
      emit,
      download,
      process,
      recordMetric,
      recordImportStarted,
      recordImportCompleted,
    };
  }

  describe('importDownload', () => {
    it('should download, process, and emit the full lifecycle over the outbound client, when the download succeeds', async () => {
      const { service, emit, download, process } = buildService();

      const result = await service.importDownload('2026-08-11-0', importId, correlationId);

      expect(result).toEqual(successfulResult);
      expect(download).toHaveBeenCalledWith('2026-08-11-0');
      expect(process).toHaveBeenCalledWith('/data/archives/2026-08-11-0.json.gz', importId);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit.mock.calls[0]?.[0]).toBe('github.import.started');
      expect(emit.mock.calls[1]?.[0]).toBe('github.import.completed');
    });
  });

  describe('importUpload', () => {
    it('should process the given file path directly without downloading, when called', async () => {
      const { service, download, process } = buildService();

      const result = await service.importUpload(
        '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        importId,
        correlationId,
      );

      expect(result).toEqual(successfulResult);
      expect(download).not.toHaveBeenCalled();
      expect(process).toHaveBeenCalledWith(
        '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        importId,
      );
    });
  });
});
