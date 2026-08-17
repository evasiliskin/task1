import { EVENT_PATTERNS } from '@task1/shared/github-archive/index';

import { importArchive, type IImportArchiveDependencies } from './import-archive.js';
import { type ImportResult } from './processing/process-archive.js';

describe('importArchive', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
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
      logger: {
        with: vi.fn().mockReturnThis(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as IImportArchiveDependencies['logger'],
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
        dependencies,
      );

      expect(result).toEqual(successfulResult);
      expect(dependencies.downloadArchive).toHaveBeenCalledWith('2026-08-11-0', importId);
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

    it('should log every stage bound to the import id, when the import succeeds', async () => {
      const lines: { fields: Record<string, unknown>; message: string }[] = [];
      const logger = {
        with: () => logger,
        info: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const dependencies = buildDependencies({ logger: logger as never });

      await importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies);

      expect(lines.map((line) => line.message)).toEqual([
        'import started',
        'archive downloaded',
        'archive processed',
        'import completed',
      ]);
      expect(lines.at(-1)?.fields).toMatchObject({ eventsProcessed: expect.any(Number) as number });
    });

    it('should record a processing-errors metric, when the result has a nonzero errorCount', async () => {
      const resultWithErrors: ImportResult = { ...successfulResult, errorCount: 3 };
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockResolvedValue(resultWithErrors),
      });

      await importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies);

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
        importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies),
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

    it('should record the failure metrics, when processArchive rejects', async () => {
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(new Error('archive processing failed')),
      });

      await expect(
        importArchive(
          { type: 'upload', filePath: '/data/archives/x.json.gz' },
          importId,
          dependencies,
        ),
      ).rejects.toThrow('archive processing failed');

      const [failureMetricEntries] = dependencies.recordMetrics.mock.calls[0] as [
        [string, number][],
      ];

      expect(failureMetricEntries).toEqual([
        ['service_a.archive.imports.failed', 1],
        ['service_a.archive.failure.duration', expect.any(Number) as number],
      ]);
    });

    it('should still record the failure metrics, when recordImportFailed rejects', async () => {
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(new Error('archive processing failed')),
        recordImportFailed: vi.fn().mockRejectedValue(new Error('mongo down')),
      });

      await expect(
        importArchive(
          { type: 'upload', filePath: '/data/archives/x.json.gz' },
          importId,
          dependencies,
        ),
      ).rejects.toThrow('mongo down');

      const [failureMetricEntries] = dependencies.recordMetrics.mock.calls[0] as [
        [string, number][],
      ];

      expect(failureMetricEntries.map(([key]) => key)).toEqual([
        'service_a.archive.imports.failed',
        'service_a.archive.failure.duration',
      ]);
    });

    it('should not record failure metrics, when the import completes successfully', async () => {
      const dependencies = buildDependencies();

      await importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies);

      const recordedKeys = dependencies.recordMetrics.mock.calls.flatMap(
        ([entries]: [[string, number][]]) => entries.map(([key]) => key),
      );

      expect(recordedKeys).not.toContain('service_a.archive.imports.failed');
      expect(recordedKeys).not.toContain('service_a.archive.failure.duration');
    });
  });

  describe('claim ordering', () => {
    it('should not emit IMPORT_STARTED, when the import run cannot be claimed', async () => {
      const dependencies = buildDependencies({
        recordImportStarted: vi.fn().mockRejectedValue(new Error('E11000 duplicate key')),
      });

      await expect(
        importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies),
      ).rejects.toThrow('E11000 duplicate key');

      expect(dependencies.emitEvent).not.toHaveBeenCalled();
      expect(dependencies.downloadArchive).not.toHaveBeenCalled();
    });

    it('should emit IMPORT_STARTED, when the claim has succeeded', async () => {
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

      await importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies);

      expect(callOrder[0]).toBe('claim');
      expect(callOrder[1]).toBe(`emit:${EVENT_PATTERNS.IMPORT_STARTED}`);
    });
  });

  describe('archive cleanup', () => {
    it('should delete the downloaded archive, when the import succeeds', async () => {
      const dependencies = buildDependencies();

      await importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies);

      expect(dependencies.deleteArchive).toHaveBeenCalledWith(
        '/data/archives/2026-08-11-0.json.gz',
      );
    });

    it('should delete the downloaded archive, even when processing fails', async () => {
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(new Error('corrupt gzip')),
      });

      await expect(
        importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies),
      ).rejects.toThrow('corrupt gzip');

      expect(dependencies.deleteArchive).toHaveBeenCalledWith(
        '/data/archives/2026-08-11-0.json.gz',
      );
    });

    it('should keep the uploaded archive, when processing fails', async () => {
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(new Error('mongo down')),
      });

      await expect(
        importArchive(
          { type: 'upload', filePath: '/data/archives/x.json.gz' },
          importId,
          dependencies,
        ),
      ).rejects.toThrow('mongo down');

      expect(dependencies.deleteArchive).not.toHaveBeenCalled();
    });

    it('should not fail the import, when deleting the archive fails', async () => {
      const dependencies = buildDependencies({
        deleteArchive: vi.fn().mockRejectedValue(new Error('EBUSY')),
      });

      await expect(
        importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, dependencies),
      ).resolves.toEqual(successfulResult);
    });
  });
});
