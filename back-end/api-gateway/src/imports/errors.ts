import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class MissingUploadFileError extends ValidationError {
  public constructor() {
    super('No archive file was provided in the "file" form field', {
      code: 'MISSING_UPLOAD_FILE',
      category: ErrorCategory.VALIDATION,
    });
  }
}

export class UnsupportedArchiveFormatError extends ValidationError {
  public constructor(filename: string) {
    super(`Unsupported archive file format: "${filename}" (expected a ".json.gz" file)`, {
      code: 'UNSUPPORTED_ARCHIVE_FORMAT',
      category: ErrorCategory.VALIDATION,
      params: { filename },
    });
  }
}

export class ArchiveUploadError extends AppError {
  public constructor(message: string, importId: string, cause?: Error) {
    super(message, {
      code: 'ARCHIVE_UPLOAD_FAILED',
      category: ErrorCategory.EXTERNAL,
      params: { importId },
      cause,
    });
  }
}

export class InvalidIdempotencyKeyError extends ValidationError {
  public constructor(idempotencyKey: string) {
    super(`Idempotency-Key header must be a UUID; received "${idempotencyKey}"`, {
      code: 'INVALID_IDEMPOTENCY_KEY',
      category: ErrorCategory.VALIDATION,
      params: { idempotencyKey },
    });
  }
}
