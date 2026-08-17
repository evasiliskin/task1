export interface IFieldError {
  field: string;
  errorType: string;
  message: string;
  constraints?: Record<string, number>;
}
