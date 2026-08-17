import { AppError } from '../base/app-error.js';
import { ErrorCategory } from '../error-category.enum.js';

export class MessagePublishFailedError extends AppError {
  public constructor(pattern: string, cause?: unknown) {
    super(`Failed to publish message with pattern "${pattern}" to the broker`, {
      code: 'MESSAGE_PUBLISH_FAILED',
      category: ErrorCategory.EXTERNAL,
      params: { pattern },
      cause,
    });
  }
}
