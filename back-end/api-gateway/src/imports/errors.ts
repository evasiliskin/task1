import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class MissingUploadFileError extends ValidationError {
  public constructor() {
    super(
      'No archive file was provided in the "file" form field',
      MissingUploadFileError.buildOptions({
        code: 'MISSING_UPLOAD_FILE',
        category: ErrorCategory.VALIDATION,
      }),
    );
  }
}

export class UnsupportedArchiveFormatError extends ValidationError {
  public constructor(filename: string) {
    super(
      `Unsupported archive file format: "${filename}" (expected a ".json.gz" file)`,
      UnsupportedArchiveFormatError.buildOptions({
        code: 'UNSUPPORTED_ARCHIVE_FORMAT',
        category: ErrorCategory.VALIDATION,
        params: { filename },
      }),
    );
  }
}

export class ArchiveUploadError extends AppError {
  public constructor(message: string, importId: string, cause?: Error) {
    super(
      message,
      ArchiveUploadError.buildOptions({
        code: 'ARCHIVE_UPLOAD_FAILED',
        category: ErrorCategory.EXTERNAL,
        params: { importId },
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  }
}

export class InvalidIdempotencyKeyError extends ValidationError {
  public constructor(idempotencyKey: string) {
    super(
      `Idempotency-Key header must be a UUID; received "${idempotencyKey}"`,
      InvalidIdempotencyKeyError.buildOptions({
        code: 'INVALID_IDEMPOTENCY_KEY',
        category: ErrorCategory.VALIDATION,
        params: { idempotencyKey },
      }),
    );
  }
}
