import { join } from 'node:path';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { generateReport } from './generate-report.js';

describe('generateReport', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const stats: IStatsResult = {
    archivesProcessed: 1,
    eventsProcessed: 1,
    successfulEvents: 1,
    invalidEvents: 0,
    errors: 0,
    timeSeries: [],
    degraded: false,
  };

  it('should build the report at a unique path inside the report directory prefixed with importId, when importId is given', async () => {
    const getStats = vi.fn().mockResolvedValue(stats);
    const buildReportMock = vi.fn().mockResolvedValue(undefined);

    const result = await generateReport(
      '/data/reports',
      { getStats, buildReport: buildReportMock },
      importId,
    );

    expect(getStats).toHaveBeenCalledWith(importId);
    expect(buildReportMock).toHaveBeenCalledWith(stats, result.reportPath, false);
    expect(result.reportPath.startsWith(join('/data/reports', importId))).toBe(true);
    expect(result.reportPath.endsWith('.pdf')).toBe(true);
  });

  it('should build the report at a different path on each call, when importId is given', async () => {
    const getStats = vi.fn().mockResolvedValue(stats);
    const buildReportMock = vi.fn().mockResolvedValue(undefined);

    const first = await generateReport(
      '/data/reports',
      { getStats, buildReport: buildReportMock },
      importId,
    );
    const second = await generateReport(
      '/data/reports',
      { getStats, buildReport: buildReportMock },
      importId,
    );

    expect(first.reportPath).not.toBe(second.reportPath);
  });

  it('should derive a random .pdf filename inside the report directory, when importId is omitted', async () => {
    const getStats = vi.fn().mockResolvedValue(stats);
    const buildReportMock = vi.fn().mockResolvedValue(undefined);

    const result = await generateReport('/data/reports', {
      getStats,
      buildReport: buildReportMock,
    });

    expect(getStats).toHaveBeenCalledWith(undefined);
    expect(buildReportMock).toHaveBeenCalledWith(stats, result.reportPath, true);
    expect(result.reportPath.startsWith(join('/data/reports'))).toBe(true);
    expect(result.reportPath.endsWith('.pdf')).toBe(true);
  });

  it('should propagate the error and never call buildReport, when getStats rejects', async () => {
    const getStats = vi.fn().mockRejectedValue(new Error('mongo unavailable'));
    const buildReportMock = vi.fn();

    await expect(
      generateReport('/data/reports', { getStats, buildReport: buildReportMock }, importId),
    ).rejects.toThrow('mongo unavailable');
    expect(buildReportMock).not.toHaveBeenCalled();
  });
});
