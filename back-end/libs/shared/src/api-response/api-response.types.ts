export interface IApiTracingMeta {
  correlationId: string;
}

export interface IApiResponseMeta {
  tracing: IApiTracingMeta;
}

export interface IApiPagination {
  nextCursor?: string;
}

export interface IApiSingleResult<T> {
  data: T;
}

export interface IApiListResult<T> {
  items: readonly T[];
  pagination: IApiPagination;
}

export interface IApiSuccessResponse<T = unknown> {
  status: 'SUCCESS';
  code: number;
  message: string;
  result: IApiSingleResult<T> | IApiListResult<T>;
  meta: IApiResponseMeta;
}

export interface ICheckFailed {
  field: string;
  errorType: string;
  message: string;
  constraints?: Record<string, number>;
}

export interface IApiErrorDetails {
  checksFailed: readonly ICheckFailed[];
}

export interface IApiErrorResponse {
  status: 'FAILED';
  code: number;
  reason: string;
  message: string;
  details?: IApiErrorDetails;
  meta: IApiResponseMeta;
}
