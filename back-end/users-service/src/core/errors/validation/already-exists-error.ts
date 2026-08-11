import { AppError } from '../base/app-error';
import { ErrorCategory } from '../error-category.enum';

import { ValidationError } from './validation-error';

export const ALREADY_EXISTS_CODE = 'ALREADY_EXISTS';

export interface IAlreadyExistsErrorParameters {
  entityName: string;
  field: string;
  value: string;
}

export class AlreadyExistsError extends ValidationError {
  public constructor(parameters: IAlreadyExistsErrorParameters, options?: { cause?: Error }) {
    const message = `${parameters.entityName} with ${parameters.field} "${parameters.value}" already exists`;

    super(
      message,
      AppError.buildOptions(
        {
          code: ALREADY_EXISTS_CODE,
          category: ErrorCategory.VALIDATION,
          params: { ...parameters },
        },
        options,
      ),
    );
  }
}
