import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { ArchiveDownloadError } from './errors.js';
import { streamToTemporaryFile, toDownloadError } from './stream-to-temporary-file.js';

describe('streamToTemporaryFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'stream-temp-spec-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('should write the stream to the temporary path, when the stream completes', async () => {
    const path = join(directory, 'a.download.tmp');

    await streamToTemporaryFile(Readable.from([Buffer.from('hello')]), path, 10_000);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(readFileSync(path, 'utf8')).toBe('hello');
  });

  it('should destroy the stream, when the total timeout elapses', async () => {
    const path = join(directory, 'b.download.tmp');
    const stalled = new Readable({ read: () => undefined });

    await expect(streamToTemporaryFile(stalled, path, 20)).rejects.toThrow(/timed out/);
    expect(stalled.destroyed).toBe(true);
  });

  it('should clear the watchdog timer, when the stream completes', async () => {
    const path = join(directory, 'c.download.tmp');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await streamToTemporaryFile(Readable.from([Buffer.from('x')]), path, 10_000);

    expect(clearSpy).toHaveBeenCalled();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    expect(existsSync(path)).toBe(true);
  });
});

describe('toDownloadError', () => {
  it('should rethrow the error unchanged, when it is already an ArchiveDownloadError', () => {
    const original = new ArchiveDownloadError('boom', 'https://example.test/a.gz', 500);

    expect(toDownloadError(original, 'https://example.test/a.gz')).toBe(original);
  });

  it('should wrap the error and preserve it as the cause, when it is any other Error', () => {
    const cause = new Error('socket hang up');
    const wrapped = toDownloadError(cause, 'https://example.test/a.gz');

    expect(wrapped).toBeInstanceOf(ArchiveDownloadError);
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.message).toContain('socket hang up');
  });

  it('should wrap the value without setting a cause, when a non-Error is thrown', () => {
    const wrapped = toDownloadError('boom', 'https://example.test/a.gz');

    expect(wrapped).toBeInstanceOf(ArchiveDownloadError);
    expect(wrapped.cause).toBeUndefined();
    expect(wrapped.message).toContain('boom');
  });
});
