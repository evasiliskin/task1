import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type ReportConfiguration } from '../config/report.config.js';

import { ReportCleanupService } from './report-cleanup.service.js';

describe('ReportCleanupService', () => {
  const requestContextService = new RequestContextService();

  let reportDirectory: string;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'report-cleanup-spec-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  function writeReport(name: string, hoursAgo: number): string {
    const path = join(reportDirectory, name);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    writeFileSync(path, '%PDF-1.4 fake report body');

    const when = new Date(Date.now() - hoursAgo * 3_600_000);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    utimesSync(path, when, when);

    return path;
  }

  function buildService(
    logger: object = { info: vi.fn(), warn: vi.fn() },
    directory: string = reportDirectory,
  ): ReportCleanupService {
    const reportConfiguration: ReportConfiguration = {
      dir: directory,
      retentionMs: 3_600_000,
      sweepIntervalMs: 600_000,
    };

    return new ReportCleanupService(reportConfiguration, requestContextService, {
      getLogger: () => logger,
    } as never);
  }

  describe('startup sweep', () => {
    it('should delete only the older files, when some reports fall outside the retention window', async () => {
      const old = writeReport('old.pdf', 5);
      const fresh = writeReport('fresh.pdf', 0);
      const service = buildService();

      await service.onModuleInit();
      service.onModuleDestroy();

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      expect(existsSync(old)).toBe(false);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      expect(existsSync(fresh)).toBe(true);
    });

    it('should leave the file in place, when it is not a PDF', async () => {
      const path = writeReport('notes.txt', 5);
      const service = buildService();

      await service.onModuleInit();
      service.onModuleDestroy();

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      expect(existsSync(path)).toBe(true);
    });

    it('should leave the entry in place, when it cannot be removed', async () => {
      const path = join(reportDirectory, 'stuck.pdf');

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      mkdirSync(path);

      const when = new Date(Date.now() - 5 * 3_600_000);

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      utimesSync(path, when, when);

      const logger = { info: vi.fn(), warn: vi.fn() };
      const service = buildService(logger);

      await service.onModuleInit();
      service.onModuleDestroy();

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      expect(existsSync(path)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should log nothing, when the directory holds no expired report', async () => {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const service = buildService(logger);

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should not prevent startup, when the report directory does not exist yet', async () => {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const service = buildService(logger, join(reportDirectory, 'does-not-exist'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      service.onModuleDestroy();

      expect(logger.warn).toHaveBeenCalledWith(
        {},
        'Could not sweep the report directory',
        expect.anything(),
      );
    });
  });

  describe('recurring sweep', () => {
    it('should schedule a recurring unreferenced sweep at the configured interval, when the module initializes', async () => {
      const unref = vi.fn();
      const setIntervalSpy = vi
        .spyOn(global, 'setInterval')
        .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
      const service = buildService();

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 600_000);
      expect(unref).toHaveBeenCalledTimes(1);
    });

    it('should run a sweep, when the timer fires', async () => {
      let scheduled: (() => void) | undefined;

      vi.spyOn(global, 'setInterval').mockImplementation((callback: () => void) => {
        scheduled = callback;

        return { unref: vi.fn() } as unknown as NodeJS.Timeout;
      });

      const service = buildService();

      await service.onModuleInit();

      const path = writeReport('old.pdf', 5);

      scheduled?.();

      await vi.waitFor(() => {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
        expect(existsSync(path)).toBe(false);
      });

      service.onModuleDestroy();
    });

    it('should clear the timer, when the module is destroyed', async () => {
      const timerHandle = { unref: vi.fn() } as unknown as NodeJS.Timeout;

      vi.spyOn(global, 'setInterval').mockReturnValue(timerHandle);

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const service = buildService();

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);
    });

    it('should not throw, when the module is destroyed without a prior init', () => {
      const service = buildService();

      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('root context', () => {
    it('should log every line under a single correlation id, when one sweep runs', async () => {
      writeReport('old.pdf', 5);

      const loggedContexts: { correlationId?: string; operation?: string }[] = [];
      const capturingLogger = {
        info: (): void => {
          loggedContexts.push(requestContextService.getAttributes());
        },
        warn: (): void => {
          loggedContexts.push(requestContextService.getAttributes());
        },
      };
      const service = buildService(capturingLogger);

      await service.onModuleInit();
      service.onModuleDestroy();

      const correlationIds = new Set(loggedContexts.map((context) => context.correlationId));

      expect(correlationIds.size).toBe(1);
      expect(loggedContexts[0]).toMatchObject({ operation: 'report-sweep' });
    });
  });
});
