import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { buildReport } from './build-report.js';

describe('buildReport', () => {
  let reportDirectory: string;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'build-report-spec-'));
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
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
    };

    await buildReport(stats, reportPath, true);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-generated paths are safe
    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
