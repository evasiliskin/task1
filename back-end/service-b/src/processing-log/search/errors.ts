import { ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class InvalidCursorError extends ValidationError {
  public constructor(cursor: string, cause?: Error) {
    super(
      'The provided cursor is not valid',
      {
        code: 'INVALID_CURSOR',
        category: ErrorCategory.VALIDATION,
        params: { cursor },
        cause,
      },
    );
  }
}
