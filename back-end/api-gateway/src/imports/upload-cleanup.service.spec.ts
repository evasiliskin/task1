import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UploadCleanupService } from './upload-cleanup.service.js';

describe('UploadCleanupService', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-cleanup-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function writeFileInStorage(name: string, hoursAgo: number): string {
    const path = join(storageDirectory, name);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    writeFileSync(path, 'x');

    const when = new Date(Date.now() - hoursAgo * 3_600_000);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    utimesSync(path, when, when);

    return path;
  }

  function buildService(): UploadCleanupService {
    return new UploadCleanupService(
      {
        dir: storageDirectory,
        uploadRetentionMs: 3_600_000,
        uploadSweepIntervalMs: 900_000,
      },
      { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
      { getLogger: () => ({ info: vi.fn(), warn: vi.fn() }) } as never,
    );
  }

  it('should remove an orphaned archive past its retention window', async () => {
    const path = writeFileInStorage('aaa.json.gz', 5);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(false);
  });

  it('should remove an abandoned upload temp file past retention', async () => {
    const path = writeFileInStorage('bbb.upload.tmp', 5);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(false);
  });

  it('should keep an archive still inside the retention window', async () => {
    const path = writeFileInStorage('ccc.json.gz', 0);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should not touch service-a download temp files it does not own', async () => {
    const path = writeFileInStorage('ddd.download.tmp', 5);
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should clear its timer on destroy', async () => {
    const service = buildService();

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(service.hasScheduledSweep()).toBe(false);
  });
});
