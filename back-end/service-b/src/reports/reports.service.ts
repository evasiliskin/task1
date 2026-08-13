import { Inject, Injectable } from '@nestjs/common';

import reportConfig, { type ReportConfiguration } from '../config/report.config.js';
import { StatsService } from '../processing-log/stats/stats.service.js';

import { buildReport } from './build-report.js';
import { generateReport, type IGenerateReportResult } from './generate-report.js';

@Injectable()
export class ReportsService {
  public constructor(
    private readonly statsService: StatsService,
    @Inject(reportConfig.KEY) private readonly reportConfiguration: ReportConfiguration,
  ) {}

  public generateReport(importId?: string): Promise<IGenerateReportResult> {
    return generateReport(
      this.reportConfiguration.dir,
      {
        getStats: (id) => this.statsService.getStats(id),
        buildReport,
      },
      importId,
    );
  }
}
