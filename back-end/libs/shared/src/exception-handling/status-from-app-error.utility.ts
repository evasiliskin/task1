import { HttpStatus } from '@nestjs/common';

import { type AppError, AuthError, ValidationError } from '../errors/index.js';

export function statusFromAppError(error: AppError): number {
  if (error instanceof AuthError) {
    return HttpStatus.UNAUTHORIZED;
  }

  if (error instanceof ValidationError) {
    return HttpStatus.BAD_REQUEST;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
