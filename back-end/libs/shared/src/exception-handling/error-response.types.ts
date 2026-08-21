import { type IErrorDetail } from '../errors/base/error-detail.types.js';
import { type IFieldError } from '../errors/validation/field-error.types.js';

export type IApiErrorDetail = IErrorDetail;

export interface IApiErrorBody {
  code: string;
  category?: string;
  message: string;
  details?: readonly IApiErrorDetail[];
  fieldErrors?: readonly IFieldError[];
}
