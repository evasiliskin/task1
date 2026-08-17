import { ErrorCategory } from '../error-category.enum.js';

import { ValidationError } from './validation-error.js';

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
