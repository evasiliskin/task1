import { readdir, stat, unlink } from 'node:fs/promises';

import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type ReportConfiguration } from '../config/report.config.js';

import { ReportCleanupService } from './report-cleanup.service.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

describe('ReportCleanupService', () => {
  const reportConfiguration: ReportConfiguration = {
    dir: '/data/reports',
    retentionMs: 3_600_000,
    sweepIntervalMs: 600_000,
  };
  const loggerService = { getLogger: () => ({ info: vi.fn(), warn: vi.fn() }) };
  const requestContextService = new RequestContextService();

  beforeEach(() => {
    vi.mocked(readdir).mockReset();
    vi.mocked(stat).mockReset();
    vi.mocked(unlink).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startup sweep (12a)', () => {
    it('should delete report files older than the retention window and keep newer ones', async () => {
      vi.mocked(readdir).mockResolvedValue(['old.pdf', 'fresh.pdf'] as never);
      vi.mocked(stat).mockImplementation(
        (path) => ({ mtimeMs: String(path).includes('old') ? 0 : Date.now() }) as never,
      );

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );
      await service.onModuleInit();
      service.onModuleDestroy();

      expect(unlink).toHaveBeenCalledTimes(1);
      expect(unlink).toHaveBeenCalledWith('\\data\\reports\\old.pdf');
    });

    it('should ignore files that are not PDFs', async () => {
      vi.mocked(readdir).mockResolvedValue(['notes.txt'] as never);

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );
      await service.onModuleInit();
      service.onModuleDestroy();

      expect(unlink).not.toHaveBeenCalled();
    });

    it('should not prevent startup when the report directory does not exist yet', async () => {
      vi.mocked(readdir).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      service.onModuleDestroy();
    });
  });

  describe('recurring sweep (12b)', () => {
    it('should schedule a recurring sweep at the configured interval and unref the timer', async () => {
      vi.mocked(readdir).mockResolvedValue([]);
      const unrefSpy = vi.fn();
      const setIntervalSpy = vi
        .spyOn(global, 'setInterval')
        .mockReturnValue({ unref: unrefSpy } as unknown as NodeJS.Timeout);

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );
      await service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 600_000);
      expect(unrefSpy).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
    });

    it('should invoke a sweep each time the timer fires', async () => {
      vi.mocked(readdir).mockResolvedValue(['old.pdf'] as never);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 0 } as never);
      vi.mocked(unlink).mockResolvedValue(undefined);
      let scheduled: (() => void) | undefined;
      vi.spyOn(global, 'setInterval').mockImplementation((callback: () => void) => {
        scheduled = callback;

        return { unref: vi.fn() } as unknown as NodeJS.Timeout;
      });

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );
      await service.onModuleInit();

      expect(unlink).toHaveBeenCalledTimes(1);

      scheduled?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(unlink).toHaveBeenCalledTimes(2);

      service.onModuleDestroy();
    });

    it('should clear the timer on module destroy', async () => {
      vi.mocked(readdir).mockResolvedValue([]);
      const timerHandle = { unref: vi.fn() } as unknown as NodeJS.Timeout;
      vi.spyOn(global, 'setInterval').mockReturnValue(timerHandle);
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );
      await service.onModuleInit();

      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);
    });

    it('should not throw when module destroy is called without a prior module init', () => {
      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        loggerService as never,
      );

      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('root context (Task 12)', () => {
    it('should log every line of one sweep under a single correlation id', async () => {
      vi.mocked(readdir).mockResolvedValue(['old.pdf'] as never);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 0 } as never);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const loggedContexts: { correlationId?: string; operation?: string }[] = [];
      const capturingLoggerService = {
        getLogger: () => ({
          info: () => {
            loggedContexts.push(requestContextService.getAttributes());
          },
          warn: () => {
            loggedContexts.push(requestContextService.getAttributes());
          },
        }),
      };

      const service = new ReportCleanupService(
        reportConfiguration,
        requestContextService,
        capturingLoggerService as never,
      );

      await service.onModuleInit();
      service.onModuleDestroy();

      const correlationIds = new Set(loggedContexts.map((context) => context.correlationId));

      expect(correlationIds.size).toBe(1);
      expect(loggedContexts[0]).toMatchObject({ operation: 'report-sweep' });
    });
  });
});
