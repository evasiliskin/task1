import { ErrorCategory } from '../error-category.enum.js';

import { InternalError } from './internal-error.js';

export interface IMissingContractErrorParameters {
  controllerName: string;
  methodName: string;
}

export class MissingContractError extends InternalError {
  public constructor(parameters: IMissingContractErrorParameters, options?: { cause?: Error }) {
    super(
      `Endpoint is missing an @Contract declaration: ${parameters.controllerName}.${parameters.methodName}`,
      {
        code: 'MISSING_CONTRACT',
        category: ErrorCategory.INTERNAL,
        params: { controllerName: parameters.controllerName, methodName: parameters.methodName },
        cause: options?.cause,
      },
    );
  }
}
