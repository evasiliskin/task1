import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class ArchiveProcessingError extends AppError {
  public constructor(message: string, importId: string, filePath: string, cause?: Error) {
    super(message, {
      code: 'ARCHIVE_PROCESSING_FAILED',
      category: ErrorCategory.EXTERNAL,
      params: { importId, filePath },
      cause,
    });
  }
}

export class ArchiveTooLargeError extends ValidationError {
  public constructor(maxDecompressedBytes: number) {
    super(`Archive exceeds the maximum decompressed size of ${maxDecompressedBytes} bytes`, {
      code: 'ARCHIVE_TOO_LARGE',
      category: ErrorCategory.VALIDATION,
      params: { maxDecompressedBytes },
    });
  }
}

export class LineTooLongError extends ValidationError {
  public constructor(maxLineBytes: number) {
    super(`Archive contains a line longer than the maximum of ${maxLineBytes} bytes`, {
      code: 'ARCHIVE_LINE_TOO_LONG',
      category: ErrorCategory.VALIDATION,
      params: { maxLineBytes },
    });
  }
}
