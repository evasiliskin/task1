import { AppError, ErrorCategory } from '@task1/shared/errors/index';

export class ArchiveProcessingError extends AppError {
  public constructor(message: string, importId: string, filePath: string, cause?: Error) {
    super(
      message,
      ArchiveProcessingError.buildOptions({
        code: 'ARCHIVE_PROCESSING_FAILED',
        category: ErrorCategory.EXTERNAL,
        params: { importId, filePath },
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  }
}
