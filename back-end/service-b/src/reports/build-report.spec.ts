import { createWriteStream, mkdtempSync, readFileSync, rmSync, type WriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { vi } from 'vitest';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { buildReport } from './build-report.js';

// Mock the fs and fs/promises modules
vi.mock('node:fs', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- generic type argument needs the actual module shape; a separate `import type` of the same specifier would collide with the value import above (import/no-duplicates).
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');

  return {
    ...actual,
    createWriteStream: vi.fn(actual.createWriteStream),
  };
});

vi.mock('node:fs/promises', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- generic type argument needs the actual module shape; a separate `import type` of the same specifier would collide with the value import above (import/no-duplicates).
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  return {
    ...actual,
    unlink: vi.fn(actual.unlink),
  };
});

describe('buildReport', () => {
  let reportDirectory: string;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'build-report-spec-'));
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should write a valid PDF file to reportPath, when called with populated stats', async () => {
    const reportPath = join(reportDirectory, 'report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 3,
      eventsProcessed: 300,
      successfulEvents: 290,
      invalidEvents: 10,
      errors: 2,
      processingDurationMs: 15_000,
      timeSeries: [
        { timestamp: '2026-08-11T00:00:00.000Z', value: 100 },
        { timestamp: '2026-08-11T00:05:00.000Z', value: 200 },
      ],
      degraded: false,
    };

    await buildReport(stats, reportPath, true);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-generated paths are safe
    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('should write a valid PDF file, when timeSeries is empty and processingDurationMs is undefined', async () => {
    const reportPath = join(reportDirectory, 'empty-report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    await buildReport(stats, reportPath, true);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-generated paths are safe
    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('should create the report directory, when it does not yet exist', async () => {
    const nestedDirectory = join(reportDirectory, 'nested');
    const reportPath = join(nestedDirectory, 'report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    await buildReport(stats, reportPath, true);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-generated paths are safe
    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('should destroy the write stream and remove the partial file, when PDF generation fails', async () => {
    const reportPath = join(reportDirectory, 'error-report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    // Use a real PassThrough stream so PDFDocument's pipe() behaves normally,
    // but spy on destroy() so we can assert it was called. The stream emits an
    // 'error' synchronously in response to its own 'pipe' event — that event
    // fires synchronously inside document.pipe(writeStream), i.e. strictly
    // after build-report.ts has already attached its 'error' listener and
    // strictly before document.end() writes any data, so this reliably
    // exercises the failure path without racing real PDF generation.
    const passThroughStream = new PassThrough();
    const destroySpy = vi
      .spyOn(passThroughStream, 'destroy')
      .mockImplementation(() => passThroughStream);
    passThroughStream.on('pipe', () => {
      passThroughStream.emit('error', new Error('ENOSPC'));
    });

    vi.mocked(createWriteStream).mockReturnValueOnce(passThroughStream as unknown as WriteStream);

    await expect(buildReport(stats, reportPath, true)).rejects.toThrow('ENOSPC');

    expect(destroySpy).toHaveBeenCalled();
    expect(vi.mocked(unlink)).toHaveBeenCalledWith(reportPath);
  });
});
