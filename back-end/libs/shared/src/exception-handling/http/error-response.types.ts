import { type IApiErrorBody } from '../error-response.types.js';

export interface IApiErrorResponse {
  statusCode: number;
  error: IApiErrorBody;
  correlationId: string;
  requestId: string;
}
