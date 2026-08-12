import { HttpStatus } from '@nestjs/common';

import { type AppError, AuthError } from '../errors/index.js';

export function statusFromAppError(error: AppError): number {
  if (error instanceof AuthError) {
    return HttpStatus.UNAUTHORIZED;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
