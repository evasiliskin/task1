import { ErrorCategory } from '../error-category.enum.js';

import { InvalidCursorError } from './invalid-cursor.error.js';

describe('InvalidCursorError', () => {
  it('should be a validation error carrying the offending cursor', () => {
    const error = new InvalidCursorError('bm90LWEtY3Vyc29y');

    expect(error.code).toBe('INVALID_CURSOR');
    expect(error.category).toBe(ErrorCategory.VALIDATION);
    expect(error.params).toEqual({ cursor: 'bm90LWEtY3Vyc29y' });
  });

  it('should keep the underlying cause when one is supplied', () => {
    const cause = new SyntaxError('bad base64');

    expect(new InvalidCursorError('x', cause).cause).toBe(cause);
  });

  it('should not echo the cursor into the message', () => {
    expect(new InvalidCursorError('bm90LWEtY3Vyc29y').message).not.toContain('bm90');
  });
});
