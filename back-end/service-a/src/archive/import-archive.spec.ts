import { EVENT_PATTERNS } from '@task1/shared/github-archive/index';

import { importArchive, type IImportArchiveDependencies } from './import-archive.js';
import { type ImportResult } from './processing/process-archive.js';

describe('importArchive', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const successfulResult: ImportResult = {
    eventsProcessed: 10,
    validEvents: 8,
    invalidEvents: 1,
    duplicateEvents: 1,
    errorCount: 0,
  };

  function buildDependencies(
    overrides: Partial<IImportArchiveDependencies> = {},
  ): IImportArchiveDependencies &
    Record<keyof IImportArchiveDependencies, ReturnType<typeof vi.fn>> {
    return {
      downloadArchive: vi
        .fn()
        .mockResolvedValue({ filePath: '/data/archives/2026-08-11-0.json.gz' }),
      processArchive: vi.fn().mockResolvedValue(successfulResult),
      emitEvent: vi.fn(),
      recordMetric: vi.fn().mockResolvedValue(undefined),
      recordMetrics: vi.fn().mockResolvedValue(undefined),
      recordImportStarted: vi.fn().mockResolvedValue(undefined),
      recordImportCompleted: vi.fn().mockResolvedValue(undefined),
      recordImportFailed: vi.fn().mockResolvedValue(undefined),
      deleteArchive: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as IImportArchiveDependencies &
      Record<keyof IImportArchiveDependencies, ReturnType<typeof vi.fn>>;
  }

  describe('download source, success', () => {
    it('should emit started then completed, download and process the archive, and record download/processing metrics, when the download and processing both succeed', async () => {
      const dependencies = buildDependencies();

      const result = await importArchive(
        { type: 'download', dateHour: '2026-08-11-0' },
        importId,
        correlationId,
        dependencies,
      );

      expect(result).toEqual(successfulResult);
      expect(dependencies.downloadArchive).toHaveBeenCalledWith('2026-08-11-0');
      expect(dependencies.processArchive).toHaveBeenCalledWith(
        '/data/archives/2026-08-11-0.json.gz',
        importId,
      );

      const emittedPatterns = dependencies.emitEvent.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      expect(emittedPatterns).toEqual([
        EVENT_PATTERNS.IMPORT_STARTED,
        EVENT_PATTERNS.IMPORT_COMPLETED,
      ]);

      const [, startedPayload] = dependencies.emitEvent.mock.calls[0] as [
        string,
        { archive: string },
      ];
      const [, completedPayload] = dependencies.emitEvent.mock.calls[1] as [
        string,
        { archive: string; eventsProcessed: number },
      ];

      expect(startedPayload.archive).toBe('2026-08-11-0.json.gz');
      expect(completedPayload.archive).toBe('2026-08-11-0.json.gz');
      expect(completedPayload.eventsProcessed).toBe(successfulResult.eventsProcessed);

      const recordedMetricKeys = dependencies.recordMetric.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      expect(recordedMetricKeys).toEqual(['service_a.archive.download.duration']);

      const [completionMetricEntries] = dependencies.recordMetrics.mock.calls[0] as [
        [string, number][],
      ];

      expect(completionMetricEntries.map(([key]) => key)).toEqual([
        'service_a.archive.processing.duration',
        'service_a.archive.events.processed',
        'service_a.archive.events.invalid',
      ]);
      expect(dependencies.recordImportStarted).toHaveBeenCalledWith(
        importId,
        { type: 'download', archive: '2026-08-11-0.json.gz' },
        expect.any(Date),
      );
      expect(dependencies.recordImportCompleted).toHaveBeenCalledWith(
        importId,
        successfulResult,
        expect.any(Date),
      );
    });

    it('should record a processing-errors metric, when the result has a nonzero errorCount', async () => {
      const resultWithErrors: ImportResult = { ...successfulResult, errorCount: 3 };
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockResolvedValue(resultWithErrors),
      });

      await importArchive(
        { type: 'download', dateHour: '2026-08-11-0' },
        importId,
        correlationId,
        dependencies,
      );

      const [completionMetricEntries] = dependencies.recordMetrics.mock.calls[0] as [
        [string, number][],
      ];

      expect(completionMetricEntries.map(([key]) => key)).toContain(
        'service_a.archive.processing.errors',
      );
    });
  });

  describe('upload source, success', () => {
    it('should skip the download step and its duration metric, when the source is an upload', async () => {
      const dependencies = buildDependencies();

      await importArchive(
        { type: 'upload', filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz' },
        importId,
        correlationId,
        dependencies,
      );

      expect(dependencies.downloadArchive).not.toHaveBeenCalled();
      expect(dependencies.processArchive).toHaveBeenCalledWith(
        '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        importId,
      );

      const recordedMetricKeys = dependencies.recordMetric.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      expect(recordedMetricKeys).not.toContain('service_a.archive.download.duration');
      expect(dependencies.recordImportStarted).toHaveBeenCalledWith(
        importId,
        { type: 'upload', filename: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz' },
        expect.any(Date),
      );
    });
  });

  describe('failure', () => {
    it('should emit started then failed and record the import as failed, when downloadArchive rejects', async () => {
      const downloadError = new Error('archive download failed with HTTP 404');
      const dependencies = buildDependencies({
        downloadArchive: vi.fn().mockRejectedValue(downloadError),
      });

      await expect(
        importArchive(
          { type: 'download', dateHour: '2026-08-11-0' },
          importId,
          correlationId,
          dependencies,
        ),
      ).rejects.toThrow(downloadError);

      const emittedPatterns = dependencies.emitEvent.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      expect(emittedPatterns).toEqual([
        EVENT_PATTERNS.IMPORT_STARTED,
        EVENT_PATTERNS.IMPORT_FAILED,
      ]);
      expect(dependencies.processArchive).not.toHaveBeenCalled();
      expect(dependencies.recordImportFailed).toHaveBeenCalledWith(
        importId,
        downloadError.message,
        expect.any(Date),
      );
    });

    it('should emit started then failed and rethrow, when processArchive rejects', async () => {
      const processingError = new Error('archive processing failed');
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(processingError),
      });

      await expect(
        importArchive(
          { type: 'upload', filePath: '/data/archives/x.json.gz' },
          importId,
          correlationId,
          dependencies,
        ),
      ).rejects.toThrow(processingError);

      const emittedPatterns = dependencies.emitEvent.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      expect(emittedPatterns).toEqual([
        EVENT_PATTERNS.IMPORT_STARTED,
        EVENT_PATTERNS.IMPORT_FAILED,
      ]);
      expect(dependencies.recordImportCompleted).not.toHaveBeenCalled();
    });
  });

  describe('claim ordering', () => {
    it('should not emit IMPORT_STARTED, when the import run cannot be claimed', async () => {
      const dependencies = buildDependencies({
        recordImportStarted: vi.fn().mockRejectedValue(new Error('E11000 duplicate key')),
      });

      await expect(
        importArchive(
          { type: 'download', dateHour: '2026-08-11-0' },
          importId,
          correlationId,
          dependencies,
        ),
      ).rejects.toThrow('E11000 duplicate key');

      expect(dependencies.emitEvent).not.toHaveBeenCalled();
      expect(dependencies.downloadArchive).not.toHaveBeenCalled();
    });

    it('should emit IMPORT_STARTED only after the claim succeeds', async () => {
      const callOrder: string[] = [];
      const dependencies = buildDependencies({
        recordImportStarted: vi.fn().mockImplementation(() => {
          callOrder.push('claim');

          return Promise.resolve();
        }),
        emitEvent: vi.fn().mockImplementation((pattern: string) => {
          callOrder.push(`emit:${pattern}`);
        }),
      });

      await importArchive(
        { type: 'download', dateHour: '2026-08-11-0' },
        importId,
        correlationId,
        dependencies,
      );

      expect(callOrder[0]).toBe('claim');
      expect(callOrder[1]).toBe(`emit:${EVENT_PATTERNS.IMPORT_STARTED}`);
    });
  });

  describe('archive cleanup', () => {
    it('should delete the downloaded archive after a successful import', async () => {
      const dependencies = buildDependencies();

      await importArchive(
        { type: 'download', dateHour: '2026-08-11-0' },
        importId,
        correlationId,
        dependencies,
      );

      expect(dependencies.deleteArchive).toHaveBeenCalledWith(
        '/data/archives/2026-08-11-0.json.gz',
      );
    });

    it('should delete the downloaded archive even when processing fails, because it can be re-downloaded', async () => {
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(new Error('corrupt gzip')),
      });

      await expect(
        importArchive(
          { type: 'download', dateHour: '2026-08-11-0' },
          importId,
          correlationId,
          dependencies,
        ),
      ).rejects.toThrow('corrupt gzip');

      expect(dependencies.deleteArchive).toHaveBeenCalledWith(
        '/data/archives/2026-08-11-0.json.gz',
      );
    });

    it('should keep an uploaded archive when processing fails, because it cannot be re-obtained', async () => {
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(new Error('mongo down')),
      });

      await expect(
        importArchive(
          { type: 'upload', filePath: '/data/archives/x.json.gz' },
          importId,
          correlationId,
          dependencies,
        ),
      ).rejects.toThrow('mongo down');

      expect(dependencies.deleteArchive).not.toHaveBeenCalled();
    });

    it('should not fail the import when deletion fails', async () => {
      const dependencies = buildDependencies({
        deleteArchive: vi.fn().mockRejectedValue(new Error('EBUSY')),
      });

      await expect(
        importArchive(
          { type: 'download', dateHour: '2026-08-11-0' },
          importId,
          correlationId,
          dependencies,
        ),
      ).resolves.toEqual(successfulResult);
    });
  });
});
