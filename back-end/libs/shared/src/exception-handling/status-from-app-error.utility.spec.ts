import { HttpStatus } from '@nestjs/common';

import { AppError, AuthError, ErrorCategory } from '../errors/index.js';

import { statusFromAppError } from './status-from-app-error.utility.js';

class TestAuthError extends AuthError {
  public constructor() {
    super('test auth error', { code: 'TEST_AUTH', category: ErrorCategory.AUTH });
  }
}

class TestAppError extends AppError {
  public constructor(category: ErrorCategory) {
    super('test error', { code: 'TEST_ERROR', category });
  }
}

describe('statusFromAppError', () => {
  it('should return 401, when the error is an AuthError', () => {
    expect(statusFromAppError(new TestAuthError())).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('should return 500, when the error has category AUTH but is not an AuthError instance', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.AUTH))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should return 500, when the error category is INTERNAL', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.INTERNAL))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});
