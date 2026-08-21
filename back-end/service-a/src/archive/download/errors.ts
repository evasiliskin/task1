import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class InvalidDateHourError extends ValidationError {
  public constructor(dateHour: string) {
    super(`Invalid dateHour format: "${dateHour}" (expected YYYY-MM-DD-H, hour 0-23)`, {
      code: 'INVALID_DATE_HOUR',
      category: ErrorCategory.VALIDATION,
      params: { dateHour },
    });
  }
}

export class ArchiveDownloadError extends AppError {
  public constructor(message: string, url: string, statusCode?: number, cause?: Error) {
    const errorParameters: Record<string, unknown> =
      statusCode === undefined ? { url } : { url, statusCode };

    super(message, {
      code: 'ARCHIVE_DOWNLOAD_FAILED',
      category: ErrorCategory.EXTERNAL,
      params: errorParameters,
      cause,
    });
  }
}

const RETRYABLE_MIN_STATUS = 500;

export function isRetryableDownloadError(error: unknown): boolean {
  if (!(error instanceof ArchiveDownloadError)) {
    return false;
  }

  const statusCode = error.params?.statusCode;

  if (typeof statusCode !== 'number') {
    return true;
  }

  return statusCode >= RETRYABLE_MIN_STATUS;
}
