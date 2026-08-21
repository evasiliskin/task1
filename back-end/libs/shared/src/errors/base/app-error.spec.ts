import { ErrorCategory } from '../error-category.enum.js';
import { InternalError } from '../internal/internal-error.js';

class TestError extends InternalError {
  public constructor(
    message: string,
    options: { path?: readonly string[]; params?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { code: 'TEST_FAILURE', category: ErrorCategory.INTERNAL, ...options });
  }
}

describe('AppError', () => {
  describe('toDetail', () => {
    it('should omit path and params, when neither was supplied', () => {
      const error = new TestError('failed');

      expect(error.toDetail()).toEqual({
        code: 'TEST_FAILURE',
        category: ErrorCategory.INTERNAL,
        message: 'failed',
      });
    });

    it('should include path, when a non-empty path was supplied', () => {
      const error = new TestError('failed', { path: ['body', 'importId'] });

      expect(error.toDetail()).toMatchObject({ path: ['body', 'importId'] });
    });

    it('should omit path, when the path is an empty array', () => {
      const error = new TestError('failed', { path: [] });

      expect(error.toDetail().path).toBeUndefined();
    });

    it('should include params, when a non-empty params object was supplied', () => {
      const error = new TestError('failed', {
        params: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      });

      expect(error.toDetail()).toMatchObject({
        params: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      });
    });

    it('should omit params, when params is an empty object', () => {
      const error = new TestError('failed', { params: {} });

      expect(error.toDetail().params).toBeUndefined();
    });
  });

  describe('cause handling', () => {
    it('should leave cause undefined, when no cause was supplied', () => {
      const error = new TestError('failed');

      expect(error.cause).toBeUndefined();
    });

    it('should wrap a non-Error cause in an Error, when the cause is a plain value', () => {
      const error = new TestError('failed', { cause: 'raw string cause' });

      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause?.message).toBe('raw string cause');
    });

    it('should reuse the cause as is, when the cause is already an Error', () => {
      const inner = new Error('inner boom');
      const error = new TestError('failed', { cause: inner });

      expect(error.cause).toBe(inner);
    });
  });
});
