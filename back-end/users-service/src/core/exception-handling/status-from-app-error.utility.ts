import { HttpStatus } from '@nestjs/common';

import {
  type AppError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../errors';

export function statusFromAppError(error: AppError): number {
  if (error instanceof NotFoundError) {
    return HttpStatus.NOT_FOUND;
  }

  if (error instanceof ConflictError) {
    return HttpStatus.CONFLICT;
  }

  if (error instanceof ValidationError) {
    return HttpStatus.BAD_REQUEST;
  }

  if (error instanceof InternalError) {
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
