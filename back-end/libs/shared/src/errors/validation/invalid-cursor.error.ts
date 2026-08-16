import { ErrorCategory } from '../error-category.enum.js';

import { ValidationError } from './validation-error.js';

/**
 * Lives beside the cursor codec it guards. Both search APIs decode opaque cursors the same way and
 * reject them for the same reason, so the rule is defined once.
 */
export class InvalidCursorError extends ValidationError {
  public constructor(cursor: string, cause?: Error) {
    super('The provided cursor is not valid', {
      code: 'INVALID_CURSOR',
      category: ErrorCategory.VALIDATION,
      params: { cursor },
      cause,
    });
  }
}
