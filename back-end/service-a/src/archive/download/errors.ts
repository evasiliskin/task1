import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class InvalidDateHourError extends ValidationError {
  public constructor(dateHour: string) {
    super(
      `Invalid dateHour format: "${dateHour}" (expected YYYY-MM-DD-H, hour 0-23)`,
      InvalidDateHourError.buildOptions({
        code: 'INVALID_DATE_HOUR',
        category: ErrorCategory.VALIDATION,
        params: { dateHour },
      }),
    );
  }
}

export class ArchiveDownloadError extends AppError {
  public constructor(message: string, url: string, statusCode?: number, cause?: Error) {
    const errorParameters: Record<string, unknown> =
      statusCode === undefined ? { url } : { url, statusCode };

    super(
      message,
      ArchiveDownloadError.buildOptions({
        code: 'ARCHIVE_DOWNLOAD_FAILED',
        category: ErrorCategory.EXTERNAL,
        params: errorParameters,
        cause,
      }),
    );
  }
}
