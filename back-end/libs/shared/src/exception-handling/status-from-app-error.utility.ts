import { HttpStatus } from '@nestjs/common';

import {
  type AppError,
  AuthError,
  ErrorCategory,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';

export function statusFromAppError(error: AppError): number {
  if (error instanceof AuthError) {
    return HttpStatus.UNAUTHORIZED;
  }

  if (error instanceof NotFoundError) {
    return HttpStatus.NOT_FOUND;
  }

  if (error instanceof ValidationError) {
    return HttpStatus.BAD_REQUEST;
  }

  if (error.category === (ErrorCategory.CONFLICT as string)) {
    return HttpStatus.CONFLICT;
  }

  if (error.category === (ErrorCategory.RATE_LIMIT as string)) {
    return HttpStatus.TOO_MANY_REQUESTS;
  }

  if (error.category === (ErrorCategory.EXTERNAL as string)) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
