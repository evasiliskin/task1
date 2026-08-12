import { ErrorCategory } from '../error-category.enum.js';

import { InternalError } from './internal-error.js';

export const FATAL_ERROR_CODE = 'FATAL';

export class FatalError extends InternalError {
  public constructor(originalError: unknown) {
    super(`Fatal: ${FatalError.toError(originalError).message}`, {
      code: FATAL_ERROR_CODE,
      category: ErrorCategory.INTERNAL,
      cause: originalError,
    });
  }
}
