/**
 * A single field-level validation failure, in transport-neutral form.
 * Produced at the throw site; `ICheckFailed` is its HTTP wire-format counterpart.
 */
export interface IFieldError {
  field: string;
  errorType: string;
  message: string;
  constraints?: Record<string, number>;
}
