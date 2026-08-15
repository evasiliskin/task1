import { type ClientProxy } from '@nestjs/microservices';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';

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
    recordMetrics: ReturnType<typeof vi.fn>;
    recordImportStarted: ReturnType<typeof vi.fn>;
    recordImportCompleted: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    runInContext: <T>(callback: () => T) => T;
  } {
    const emit = vi.fn().mockReturnValue({ subscribe: vi.fn() });
    const download = vi.fn().mockResolvedValue({ filePath: '/data/archives/2026-08-11-0.json.gz' });
    const process = vi.fn().mockResolvedValue(successfulResult);
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const recordMetrics = vi.fn().mockResolvedValue(undefined);
    const recordImportStarted = vi.fn().mockResolvedValue(undefined);
    const recordImportCompleted = vi.fn().mockResolvedValue(undefined);
    const recordImportFailed = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const info = vi.fn();
    const logger = { with: () => logger, warn, info, error: vi.fn() };

    const serviceBClient = { emit } as unknown as ClientProxy;
    const metricsService = { recordMetric, recordMetrics } as unknown as MetricsService;
    const importRunTracker = {
      recordStarted: recordImportStarted,
      recordCompleted: recordImportCompleted,
      recordFailed: recordImportFailed,
    } as unknown as ImportRunTracker;
    const archiveDownloadService = { download } as unknown as ArchiveDownloadService;
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue(logger),
    } as unknown as LoggerService;
    const requestContextService = new RequestContextService();
    const propagatingClient = new ContextPropagatingClient(requestContextService);

    const service = new ImportOrchestrationService(
      serviceBClient,
      metricsService,
      importRunTracker,
      archiveDownloadService,
      archiveProcessingService,
      propagatingClient,
      loggerService,
    );

    const runInContext = <T>(callback: () => T): T =>
      requestContextService.run(
        { correlationId, requestId: 'req-1', correlationIdSource: 'inbound' },
        callback,
      );

    return {
      service,
      emit,
      download,
      process,
      recordMetric,
      recordMetrics,
      recordImportStarted,
      recordImportCompleted,
      warn,
      runInContext,
    };
  }

  describe('importDownload', () => {
    it('should download, process, and emit the full lifecycle over the outbound client, when the download succeeds', async () => {
      const { service, emit, download, process, runInContext } = buildService();

      const result = await runInContext(() => service.importDownload('2026-08-11-0', importId));

      expect(result).toEqual(successfulResult);
      expect(download).toHaveBeenCalledWith('2026-08-11-0');
      expect(process).toHaveBeenCalledWith('/data/archives/2026-08-11-0.json.gz', importId);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit.mock.calls[0]?.[0]).toBe('github.import.started');
      expect(emit.mock.calls[1]?.[0]).toBe('github.import.completed');
    });

    it('should log a warning and not throw, when the outbound client reports a publish error', async () => {
      const { service, emit, warn, runInContext } = buildService();

      emit.mockReturnValue({
        subscribe: ({ error }: { error: (error: unknown) => void }) => {
          error(new Error('channel closed'));
        },
      });

      await expect(
        runInContext(() => service.importDownload('2026-08-11-0', importId)),
      ).resolves.toEqual(successfulResult);
      expect(warn).toHaveBeenCalledWith(
        { pattern: 'github.import.started' },
        'Failed to publish lifecycle event',
        expect.any(Error),
      );
    });
  });

  describe('importUpload', () => {
    it('should process the given file path directly without downloading, when called', async () => {
      const { service, download, process, runInContext } = buildService();

      const result = await runInContext(() =>
        service.importUpload(
          '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
          importId,
        ),
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
