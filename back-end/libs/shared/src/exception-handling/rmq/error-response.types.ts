import { type IApiErrorBody } from '../error-response.types';

export interface IApiErrorResponse {
  statusCode: number;
  error: IApiErrorBody;
  correlationId: string;
  timestamp: string;
  path: string;
}
