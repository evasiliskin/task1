import { type IApiErrorBody } from './error-response.types.js';

export interface IFormattedError {
  statusCode: number;
  error: IApiErrorBody;
}

export interface IErrorFormatStrategy {
  canHandle(exception: unknown): boolean;
  format(exception: unknown): IFormattedError;
}
