import { AppError, ErrorCategory } from '@task1/shared/errors/index';

export class ImportRunInProgressError extends AppError {
  public constructor(importId: string) {
    super(`Import run "${importId}" is still held by a live consumer`, {
      code: 'IMPORT_RUN_IN_PROGRESS',
      category: ErrorCategory.CONFLICT,
      params: { importId },
    });
  }
}
