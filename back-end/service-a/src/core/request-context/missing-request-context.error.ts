import { ErrorCategory } from '../errors/error-category.enum';
import { InternalError } from '../errors/internal/internal-error';

export class MissingRequestContextError extends InternalError {
  public constructor() {
    super(
      'RequestContextService was accessed outside of an active request context',
      MissingRequestContextError.buildOptions({
        code: 'MISSING_REQUEST_CONTEXT',
        category: ErrorCategory.INTERNAL,
      }),
    );
  }
}
