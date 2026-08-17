import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildArchiveFilename,
  buildDownloadTemporaryFilename,
  buildUploadTemporaryFilename,
} from '@task1/shared/storage/archive-paths';

import { StorageCleanupService } from '../../src/archive/storage-cleanup.service.js';

const IMPORT_ID = '11111111-1111-4111-8111-111111111111';
const DOWNLOAD_TOTAL_TIMEOUT_MS = 600_000;

describe('shared archive volume ownership', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'storage-ownership-int-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function writeAged(name: string, minutesAgo: number): string {
    const path = join(storageDirectory, name);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    writeFileSync(path, 'contents');

    const when = new Date(Date.now() - minutesAgo * 60_000);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    utimesSync(path, when, when);

    return path;
  }

  function runSweep(): Promise<void> {
    return new StorageCleanupService(
      { dir: storageDirectory },
      { downloadTotalTimeoutMs: DOWNLOAD_TOTAL_TIMEOUT_MS } as never,
      { runAsRoot: (_operation: string, callback: () => unknown) => callback() } as never,
      { getLogger: () => ({ info: () => undefined, warn: () => undefined }) } as never,
    ).onModuleInit();
  }

  it('should collect only its own stale temps, when the directory holds files it does not own', async () => {
    const gatewayInFlight = writeAged(buildUploadTemporaryFilename(IMPORT_ID), 0);
    const gatewayAgedUpload = writeAged(
      buildUploadTemporaryFilename('22222222-2222-4222-8222-222222222222'),
      120,
    );
    const finalisedArchive = writeAged(buildArchiveFilename(IMPORT_ID), 120);
    const ownStaleTemp = writeAged(buildDownloadTemporaryFilename(IMPORT_ID), 120);
    const ownFreshTemp = writeAged(
      buildDownloadTemporaryFilename('33333333-3333-4333-8333-333333333333'),
      0,
    );
    const legacyTemp = writeAged(`${IMPORT_ID}.tmp`, 120);

    await runSweep();

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(gatewayInFlight)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(gatewayAgedUpload)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(finalisedArchive)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(legacyTemp)).toBe(true);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(ownStaleTemp)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(ownFreshTemp)).toBe(true);
  });

  it('should not throw, when the storage directory is missing', async () => {
    rmSync(storageDirectory, { recursive: true, force: true });

    await expect(runSweep()).resolves.toBeUndefined();
  });
});
