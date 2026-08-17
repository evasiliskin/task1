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

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
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

  it('should remove the file, when it is a stale download temp file', async () => {
    const path = writeFileInStorage('aaa.download.tmp', 'partial');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(false);
  });

  it('should leave the file in place, when it is a gateway upload temp file', async () => {
    const path = writeFileInStorage('bbb.upload.tmp', 'partial');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should leave the file in place, when it is a finalised archive', async () => {
    const path = writeFileInStorage('ccc.json.gz', 'gz');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should leave the file in place, when the download temp file could still be streaming', async () => {
    const path = writeFileInStorage('ddd.download.tmp', 'partial');

    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should leave the file in place, when it is a legacy bare .tmp file', async () => {
    const path = writeFileInStorage('eee.tmp', 'legacy');

    setMtimeMinutesAgo(path, 60);
    await buildService().onModuleInit();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });

  it('should return false, when stat throws because the file vanished concurrently', async () => {
    const nonExistentPath = join(storageDirectory, 'phantom.download.tmp');
    const service = buildService();
    const cutoff = Date.now() - 1_000_000;

    const result = await (
      service as unknown as {
        removeIfOlderThan: (path: string, cutoff: number) => Promise<boolean>;
      }
    ).removeIfOlderThan(nonExistentPath, cutoff);

    expect(result).toBe(false);
  });
});
