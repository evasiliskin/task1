import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UploadCleanupService } from './upload-cleanup.service.js';

describe('UploadCleanupService', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-cleanup-spec-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function writeFileInStorage(name: string, hoursAgo: number): string {
    const path = join(storageDirectory, name);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    writeFileSync(path, 'x');

    const when = new Date(Date.now() - hoursAgo * 3_600_000);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
    utimesSync(path, when, when);

    return path;
  }

  function buildService(
    logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } = {
      info: vi.fn(),
      warn: vi.fn(),
    },
    directory: string = storageDirectory,
  ): UploadCleanupService {
    return new UploadCleanupService(
      {
        dir: directory,
        uploadRetentionMs: 3_600_000,
        uploadSweepIntervalMs: 900_000,
      },
      { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
      { getLogger: () => logger } as never,
    );
  }

  it('should remove the archive, when it is orphaned past its retention window', async () => {
    const path = writeFileInStorage('aaa.json.gz', 5);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(false);
  });

  it('should remove the upload temp file, when it is abandoned past retention', async () => {
    const path = writeFileInStorage('bbb.upload.tmp', 5);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(false);
  });

  it('should keep the archive, when it is still inside the retention window', async () => {
    const path = writeFileInStorage('ccc.json.gz', 0);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should leave the file untouched, when it is a service-a download temp file', async () => {
    const path = writeFileInStorage('ddd.download.tmp', 5);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should leave the entry in place, when it cannot be removed', async () => {
    const path = join(storageDirectory, 'eee.json.gz');

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

  it('should log a warning without throwing, when the storage directory does not exist', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = buildService(logger, join(storageDirectory, 'does-not-exist'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    service.onModuleDestroy();

    expect(logger.warn).toHaveBeenCalledWith(
      {},
      'Could not sweep the archive storage directory',
      expect.anything(),
    );
  });

  it('should run another sweep, when the timer fires', async () => {
    let scheduled: (() => void) | undefined;

    vi.spyOn(global, 'setInterval').mockImplementation((callback: () => void) => {
      scheduled = callback;

      return { unref: vi.fn() } as unknown as NodeJS.Timeout;
    });

    const service = buildService();

    await service.onModuleInit();

    const path = writeFileInStorage('fff.json.gz', 5);

    scheduled?.();

    await vi.waitFor(() => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
      expect(existsSync(path)).toBe(false);
    });

    service.onModuleDestroy();
  });

  it('should schedule the recurring sweep at the configured interval, when the module initializes', async () => {
    const unref = vi.fn();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 900_000);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('should clear its sweep timer, when the module is destroyed', async () => {
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(service.hasScheduledSweep()).toBe(false);
  });

  it('should not throw, when the module is destroyed without a prior init', () => {
    const service = buildService();

    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
