import { ErrorCategory, InternalError } from '@task1/shared/errors/index';

export class ReportPathOutsideConfiguredDirectoryError extends InternalError {
  public constructor(reportPath: string, reportDirectory: string) {
    super(
      `Generated report path "${reportPath}" is outside the configured report directory "${reportDirectory}"`,
      {
        code: 'REPORT_PATH_OUTSIDE_CONFIGURED_DIRECTORY',
        category: ErrorCategory.INTERNAL,
        params: { reportPath, reportDirectory },
      },
    );
  }
}
