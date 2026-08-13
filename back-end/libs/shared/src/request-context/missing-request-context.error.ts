import { ErrorCategory } from '../errors/error-category.enum.js';
import { InternalError } from '../errors/internal/internal-error.js';

export class MissingRequestContextError extends InternalError {
  public constructor() {
    super(
      'RequestContextService was accessed outside of an active request context',
      {
        code: 'MISSING_REQUEST_CONTEXT',
        category: ErrorCategory.INTERNAL,
      },
    );
  }
}
