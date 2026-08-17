import { HttpStatus } from '@nestjs/common';

import {
  AppError,
  AuthError,
  ErrorCategory,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';

import { statusFromAppError } from './status-from-app-error.utility.js';

class TestAuthError extends AuthError {
  public constructor() {
    super('test auth error', { code: 'TEST_AUTH', category: ErrorCategory.AUTH });
  }
}

class TestValidationError extends ValidationError {
  public constructor() {
    super('test validation error', { code: 'TEST_VALIDATION', category: ErrorCategory.VALIDATION });
  }
}

class TestNotFoundError extends NotFoundError {
  public constructor() {
    super('test not found error', { code: 'TEST_NOT_FOUND', category: ErrorCategory.NOT_FOUND });
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

  it('should return 400, when the error is a ValidationError', () => {
    expect(statusFromAppError(new TestValidationError())).toBe(HttpStatus.BAD_REQUEST);
  });

  it('should return 500, when the error has category AUTH but is not an AuthError instance', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.AUTH))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should return 500, when the error has category VALIDATION but is not a ValidationError instance', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.VALIDATION))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should return 500, when the error category is INTERNAL', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.INTERNAL))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should return 404, when the error is a NotFoundError', () => {
    expect(statusFromAppError(new TestNotFoundError())).toBe(HttpStatus.NOT_FOUND);
  });

  it('should return 500, when the error has category NOT_FOUND but is not a NotFoundError instance', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.NOT_FOUND))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should return 409, when the error category is CONFLICT', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.CONFLICT))).toBe(HttpStatus.CONFLICT);
  });

  it('should return 429, when the error category is RATE_LIMIT', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.RATE_LIMIT))).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('should return 503, when the error category is EXTERNAL', () => {
    expect(statusFromAppError(new TestAppError(ErrorCategory.EXTERNAL))).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });
});
