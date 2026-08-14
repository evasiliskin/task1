import { ErrorCategory } from '../error-category.enum.js';

import { InternalError } from './internal-error.js';

export interface IResponseContractViolationErrorParameters {
  controllerName: string;
  methodName: string;
  errors: unknown;
}

export class ResponseContractViolationError extends InternalError {
  public constructor(
    parameters: IResponseContractViolationErrorParameters,
    options?: { cause?: Error },
  ) {
    super(
      `Response failed contract validation: ${parameters.controllerName}.${parameters.methodName}`,
      {
        code: 'RESPONSE_CONTRACT_VIOLATION',
        category: ErrorCategory.INTERNAL,
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
