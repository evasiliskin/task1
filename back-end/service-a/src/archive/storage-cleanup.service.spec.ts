import { existsSync, writeFileSync, utimesSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StorageCleanupService } from './storage-cleanup.service.js';

describe('StorageCleanupService', () => {
  let storageDirectory: string;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), 'storage-cleanup-test-'));
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  function writeFileInStorage(name: string, contents: string): string {
    const path = join(storageDirectory, name);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    writeFileSync(path, contents);

    return path;
  }

  function setMtimeMinutesAgo(path: string, minutes: number): void {
    const when = new Date(Date.now() - minutes * 60_000);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    utimesSync(path, when, when);
  }

  function buildService(): StorageCleanupService {
    return new StorageCleanupService(
      { dir: storageDirectory },
      { downloadTotalTimeoutMs: 600_000 } as never,
      { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
      { getLogger: () => ({ info: vi.fn(), warn: vi.fn() }) } as never,
    );
  }

  it('should remove a stale download temp file', async () => {
    const path = writeFileInStorage('aaa.download.tmp', 'partial');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(false);
  });

  it('should not remove the gateway upload temp files it does not own', async () => {
    const path = writeFileInStorage('bbb.upload.tmp', 'partial');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should not remove a finalised archive', async () => {
    const path = writeFileInStorage('ccc.json.gz', 'gz');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should not remove a download temp file that could still be streaming', async () => {
    const path = writeFileInStorage('ddd.download.tmp', 'partial');

    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should not remove a legacy bare .tmp file', async () => {
    const path = writeFileInStorage('eee.tmp', 'legacy');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should return false when stat throws (file deleted concurrently)', async () => {
    const nonExistentPath = join(storageDirectory, 'phantom.download.tmp');
    const service = buildService();
    const cutoff = Date.now() - 1_000_000; // Far in the past

    // Call removeIfOlderThan on a path that doesn't exist
    // The catch block should catch the ENOENT and return false without crashing
    const result = await (
      service as unknown as {
        removeIfOlderThan: (path: string, cutoff: number) => Promise<boolean>;
      }
    ).removeIfOlderThan(nonExistentPath, cutoff);

    expect(result).toBe(false);
  });
});
