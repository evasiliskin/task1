import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError } from 'mongodb';

import { ArchiveProcessingError } from './errors.js';
import { processArchive } from './process-archive.js';

describe('processArchive', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'process-archive-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function buildRawLine(eventId: string, type = 'PushEvent'): string {
    return JSON.stringify({
      id: eventId,
      type,
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: {},
    });
  }

  function writeGzippedArchive(fileName: string, lines: string[]): string {
    const filePath = join(storageDirectory, fileName);
    const gzipped = gzipSync(Buffer.from(`${lines.join('\n')}\n`));

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    writeFileSync(filePath, gzipped);

    return filePath;
  }

  it('should return correct counters and prove batching happened, when the archive has valid, invalid, and duplicate lines', async () => {
    const filePath = writeGzippedArchive('archive.json.gz', [
      buildRawLine('e1'),
      buildRawLine('e2', 'IssuesEvent'),
      '{not valid json',
      buildRawLine('e3'),
      JSON.stringify({ type: 'PushEvent' }),
      buildRawLine('e4', 'WatchEvent'),
      buildRawLine('e5'),
    ]);
    const bulkWriteError = Object.assign(new Error('bulk write failed'), {
      name: 'MongoBulkWriteError',
      insertedCount: 0,
      writeErrors: [{ code: 11000 }],
    }) as unknown as MongoBulkWriteError;
    const insertMany = vi
      .fn()
      .mockResolvedValueOnce({ insertedCount: 2 })
      .mockResolvedValueOnce({ insertedCount: 2 })
      .mockRejectedValueOnce(bulkWriteError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;
    const onInvalidLine = vi.fn();

    const result = await processArchive(
      filePath,
      'import-1',
      { collection, batchSize: 2 },
      onInvalidLine,
    );

    expect(result).toEqual({
      eventsProcessed: 7,
      validEvents: 4,
      invalidEvents: 2,
      duplicateEvents: 1,
      errorCount: 0,
    });
    expect(insertMany).toHaveBeenCalledTimes(3);
    expect(onInvalidLine).toHaveBeenCalledTimes(2);
  });

  it('should throw ArchiveProcessingError, when the file does not exist', async () => {
    const missingPath = join(storageDirectory, 'does-not-exist.json.gz');
    const insertMany = vi.fn();
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    await expect(
      processArchive(missingPath, 'import-1', { collection, batchSize: 500 }),
    ).rejects.toThrow(ArchiveProcessingError);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('should throw ArchiveProcessingError, when the file is not valid gzip content', async () => {
    const filePath = join(storageDirectory, 'not-gzip.json.gz');

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    writeFileSync(filePath, 'this is not gzip data');
    const insertMany = vi.fn();
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    await expect(
      processArchive(filePath, 'import-1', { collection, batchSize: 500 }),
    ).rejects.toThrow(ArchiveProcessingError);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('should throw ArchiveProcessingError, when a batch insert fails with a non-bulk-write error', async () => {
    const filePath = writeGzippedArchive('archive.json.gz', [buildRawLine('e1')]);
    const insertMany = vi.fn().mockRejectedValue(new Error('connection closed'));
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    await expect(
      processArchive(filePath, 'import-1', { collection, batchSize: 500 }),
    ).rejects.toThrow(ArchiveProcessingError);
  });
});
