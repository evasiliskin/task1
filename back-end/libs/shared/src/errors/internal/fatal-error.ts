import { ErrorCategory } from '../error-category.enum.js';

import { InternalError } from './internal-error.js';

export const FATAL_ERROR_CODE = 'FATAL';

/**
 * Wraps an error to signal the process must exit.
 * Used by CentralizedErrorHandlerService to decide when to call process.exit.
 */
export class FatalError extends InternalError {
  public constructor(originalError: unknown) {
    const cause = originalError instanceof Error ? originalError : new Error(String(originalError));

    super(`Fatal: ${cause.message}`, {
      code: FATAL_ERROR_CODE,
      category: ErrorCategory.INTERNAL,
      cause,
    });
  }
}
