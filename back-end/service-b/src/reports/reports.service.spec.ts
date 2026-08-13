import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ReportConfiguration } from '../config/report.config.js';
import { type StatsService } from '../processing-log/stats/stats.service.js';

import { ReportsService } from './reports.service.js';

describe('ReportsService', () => {
  let reportDirectory: string;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-service-spec-'));
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  it('should generate a PDF report using the injected stats service and configured report directory, when generateReport is called', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const getStats = vi.fn().mockResolvedValue({
      archivesProcessed: 1,
      eventsProcessed: 10,
      successfulEvents: 9,
      invalidEvents: 1,
      errors: 0,
      timeSeries: [],
    });
    const statsService = { getStats } as unknown as StatsService;
    const reportConfiguration: ReportConfiguration = { dir: reportDirectory };
    const service = new ReportsService(statsService, reportConfiguration);

    const result = await service.generateReport(importId);

    expect(getStats).toHaveBeenCalledWith(importId);
    expect(result.reportPath).toBe(join(reportDirectory, `${importId}.pdf`));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-generated paths are safe
    expect(existsSync(result.reportPath)).toBe(true);
  });
});
