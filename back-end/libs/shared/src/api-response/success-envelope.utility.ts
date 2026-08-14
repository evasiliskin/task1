import { isListResult } from '../pagination/list-result.js';

import { type IApiSuccessResponse } from './api-response.types.js';

const SUCCESS_MESSAGE = 'OK';

export function buildSuccessEnvelope(
  payload: unknown,
  correlationId: string,
  statusCode: number,
): IApiSuccessResponse<unknown> {
  return {
    status: 'SUCCESS',
    code: statusCode,
    message: SUCCESS_MESSAGE,
    result: isListResult(payload)
      ? { items: payload.items, pagination: payload.pagination }
      : { data: payload },
    meta: { tracing: { correlationId } },
  };
}
