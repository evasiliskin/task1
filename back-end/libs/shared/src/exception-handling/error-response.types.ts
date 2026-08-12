import { type IErrorDetail } from '../errors/base/error-detail.types.js';

export type IApiErrorDetail = IErrorDetail;

export interface IApiErrorBody {
  code: string;
  category?: string;
  message: string;
  details?: readonly IApiErrorDetail[];
}
