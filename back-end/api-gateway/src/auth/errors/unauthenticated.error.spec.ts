import { AppError, AuthError, ErrorCategory } from '@task1/shared';

import { UnauthenticatedError } from './unauthenticated.error.js';

describe('UnauthenticatedError', () => {
  it('should be an AuthError (and therefore an AppError) with category AUTH and code AUTH_REQUIRED, when constructed', () => {
    const error = new UnauthenticatedError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.category).toBe(ErrorCategory.AUTH);
    expect(error.code).toBe('AUTH_REQUIRED');
  });

  it('should not include request-specific or provider-specific details in its message', () => {
    const error = new UnauthenticatedError();

    expect(error.message).toBe('Authentication is required to access this resource.');
  });
});
