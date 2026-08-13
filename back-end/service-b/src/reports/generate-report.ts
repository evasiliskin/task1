import { join } from 'node:path';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { buildReportFilename } from './report-path.util.js';

export interface IGenerateReportResult {
  reportPath: string;
}

export interface IGenerateReportDependencies {
  getStats: (importId?: string) => Promise<IStatsResult>;
  buildReport: (stats: IStatsResult, reportPath: string, isAggregate: boolean) => Promise<void>;
}

export async function generateReport(
  reportDirectory: string,
  dependencies: IGenerateReportDependencies,
  importId?: string,
): Promise<IGenerateReportResult> {
  const stats = await dependencies.getStats(importId);
  const reportPath = join(reportDirectory, buildReportFilename(importId));

  await dependencies.buildReport(stats, reportPath, importId === undefined);

  return { reportPath };
}
