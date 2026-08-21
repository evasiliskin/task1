import { ErrorCategory } from '../error-category.enum.js';

import { type IFieldError } from './field-error.types.js';
import { ValidationError } from './validation-error.js';

export interface IRequestContractViolationErrorParameters {
  controllerName: string;
  methodName: string;
  fieldErrors: readonly IFieldError[];
}

export class RequestContractViolationError extends ValidationError {
  public readonly fieldErrors: readonly IFieldError[];

  public constructor(
    parameters: IRequestContractViolationErrorParameters,
    options?: { cause?: Error },
  ) {
    super('Request validation failed', {
      code: 'REQUEST_CONTRACT_VIOLATION',
      category: ErrorCategory.VALIDATION,
      params: {
        controllerName: parameters.controllerName,
        methodName: parameters.methodName,
      },
      cause: options?.cause,
    });

    this.fieldErrors = parameters.fieldErrors;
  }
}
