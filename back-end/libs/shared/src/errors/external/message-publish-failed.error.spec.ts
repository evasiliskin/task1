import { AppError } from '../base/app-error.js';
import { ErrorCategory } from '../error-category.enum.js';

import { MessagePublishFailedError } from './message-publish-failed.error.js';

describe('MessagePublishFailedError', () => {
  it('should be an external AppError carrying the pattern, when constructed', () => {
    const error = new MessagePublishFailedError('import.download');

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('MESSAGE_PUBLISH_FAILED');
    expect(error.category).toBe(ErrorCategory.EXTERNAL);
    expect(error.params).toEqual({ pattern: 'import.download' });
  });

  it('should name the pattern in its message, when constructed', () => {
    expect(new MessagePublishFailedError('import.download').message).toContain('import.download');
  });

  it('should keep the underlying cause, when one is supplied', () => {
    const cause = new Error('channel closed');

    expect(new MessagePublishFailedError('import.download', cause).cause).toBe(cause);
  });

  it('should wrap the value as an Error, when the cause is not an Error', () => {
    const error = new MessagePublishFailedError('import.download', 'channel closed');

    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause?.message).toBe('channel closed');
  });

  it('should leave the cause unset, when none is supplied', () => {
    expect(new MessagePublishFailedError('import.download').cause).toBeUndefined();
  });
});
