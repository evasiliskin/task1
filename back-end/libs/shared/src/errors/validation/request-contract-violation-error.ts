import { ErrorCategory } from '../error-category.enum.js';

import { ValidationError } from './validation-error.js';

export interface IRequestContractViolationErrorParameters {
  controllerName: string;
  methodName: string;
  errors: unknown;
}

export class RequestContractViolationError extends ValidationError {
  public constructor(
    parameters: IRequestContractViolationErrorParameters,
    options?: { cause?: Error },
  ) {
    super(
      `Request failed contract validation: ${parameters.controllerName}.${parameters.methodName}`,
      {
        code: 'REQUEST_CONTRACT_VIOLATION',
        category: ErrorCategory.VALIDATION,
        params: {
          controllerName: parameters.controllerName,
          methodName: parameters.methodName,
          errors: parameters.errors,
        },
        cause: options?.cause,
      },
    );
  }
}
