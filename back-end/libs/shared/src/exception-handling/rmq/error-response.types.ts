import { type IApiErrorBody } from '../error-response.types.js';

export interface IApiErrorResponse {
  statusCode: number;
  error: IApiErrorBody;
  correlationId: string;
  timestamp: string;
  path: string;
}
