import { AuthError, ErrorCategory } from '@task1/shared';

export class UnauthenticatedError extends AuthError {
  public constructor() {
    super('Authentication is required to access this resource.', {
      code: 'AUTH_REQUIRED',
      category: ErrorCategory.AUTH,
    });
  }
}
