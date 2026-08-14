import { HttpStatus } from '@nestjs/common';

import { type IApiErrorBody } from '../exception-handling/error-response.types.js';

import { type IApiErrorResponse } from './api-response.types.js';

const INTERNAL_ERROR_REASON = 'INTERNAL_ERROR';
const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred';

export function buildErrorEnvelope(
  statusCode: number,
  error: IApiErrorBody,
  correlationId: string,
): IApiErrorResponse {
  const meta = { tracing: { correlationId } };

  if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
    return {
      status: 'FAILED',
      code: statusCode,
      reason: INTERNAL_ERROR_REASON,
      message: INTERNAL_ERROR_MESSAGE,
      meta,
    };
  }

  const hasFieldErrors = error.fieldErrors !== undefined && error.fieldErrors.length > 0;

  return {
    status: 'FAILED',
    code: statusCode,
    reason: error.code,
    message: error.message,
    ...(hasFieldErrors && { details: { checksFailed: error.fieldErrors ?? [] } }),
    meta,
  };
}
