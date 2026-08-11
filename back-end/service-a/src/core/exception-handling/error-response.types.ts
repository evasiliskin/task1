import { type IErrorDetail } from '../errors/base/error-detail.types';

export type IApiErrorDetail = IErrorDetail;

export interface IApiErrorBody {
  code: string;
  category?: string;
  message: string;
  details?: readonly IApiErrorDetail[];
}

export interface IApiErrorResponse {
  statusCode: number;
  error: IApiErrorBody;
  correlationId: string;
  timestamp: string;
  path: string;
}
