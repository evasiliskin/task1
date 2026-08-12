import { HttpStatus } from '@nestjs/common';

import { type AppError } from '../errors/index.js';

export function statusFromAppError(_error: AppError): number {
  return HttpStatus.INTERNAL_SERVER_ERROR;
}
