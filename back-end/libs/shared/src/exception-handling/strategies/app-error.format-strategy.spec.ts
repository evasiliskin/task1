import { HttpStatus } from '@nestjs/common';

import { ErrorCategory, InternalError, NotFoundError } from '../../errors/index.js';

import { AppErrorFormatStrategy } from './app-error.format-strategy.js';

class TestNotFoundError extends NotFoundError {
  public constructor() {
    super('Import run not found', {
      code: 'IMPORT_NOT_FOUND',
      category: ErrorCategory.NOT_FOUND,
      params: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    });
  }
}

class TestInternalError extends InternalError {
  public constructor() {
    super('Something broke', {
      code: 'TEST_INTERNAL',
      category: ErrorCategory.INTERNAL,
    });
  }
}

describe('AppErrorFormatStrategy', () => {
  const strategy = new AppErrorFormatStrategy();

  describe('canHandle', () => {
    it('should return true, when the exception is an AppError', () => {
      expect(strategy.canHandle(new TestNotFoundError())).toBe(true);
    });

    it('should return false, when the exception is a plain Error', () => {
      expect(strategy.canHandle(new Error('boom'))).toBe(false);
    });

    it('should return false, when the exception is not an object', () => {
      expect(strategy.canHandle('boom')).toBe(false);
    });
  });

  describe('format', () => {
    it('should map the error onto its HTTP status and detail, when the error is a NotFoundError', () => {
      const error = new TestNotFoundError();

      expect(strategy.format(error)).toEqual({
        statusCode: HttpStatus.NOT_FOUND,
        error: {
          code: 'IMPORT_NOT_FOUND',
          category: ErrorCategory.NOT_FOUND,
          message: 'Import run not found',
          details: [
            {
              code: 'IMPORT_NOT_FOUND',
              category: ErrorCategory.NOT_FOUND,
              params: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
              message: 'Import run not found',
            },
          ],
        },
      });
    });

    it('should map the error onto a 500, when the category has no dedicated status', () => {
      expect(strategy.format(new TestInternalError()).statusCode).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it('should omit params from the detail, when the error carries none', () => {
      const [detail] = strategy.format(new TestInternalError()).error.details ?? [];

      expect(detail).toEqual({
        code: 'TEST_INTERNAL',
        category: ErrorCategory.INTERNAL,
        message: 'Something broke',
      });
    });
  });
});
