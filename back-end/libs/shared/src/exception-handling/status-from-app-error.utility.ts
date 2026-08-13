import { HttpStatus } from '@nestjs/common';

import { type AppError, AuthError, NotFoundError, ValidationError } from '../errors/index.js';

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

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
