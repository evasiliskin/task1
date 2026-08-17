import { AppError, ErrorCategory } from '@task1/shared/errors/index';

export class ImportAlreadyClaimedError extends AppError {
  public constructor(importId: string) {
    super(`Import run "${importId}" has already been claimed by another consumer`, {
      code: 'IMPORT_ALREADY_CLAIMED',
      category: ErrorCategory.CONFLICT,
      params: { importId },
    });
  }
}
