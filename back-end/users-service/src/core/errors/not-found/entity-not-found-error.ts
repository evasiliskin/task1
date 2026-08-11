import { AppError } from '../base/app-error';
import { ErrorCategory } from '../error-category.enum';

import { NotFoundError } from './not-found-error';

export const ENTITY_NOT_FOUND_CODE = 'ENTITY_NOT_FOUND';

export interface IEntityNotFoundErrorParameters {
  entityName: string;
  criteria: string;
}

export class EntityNotFoundError extends NotFoundError {
  public constructor(parameters: IEntityNotFoundErrorParameters, options?: { cause?: Error }) {
    const message = `${parameters.entityName} not found (${parameters.criteria})`;

    super(
      message,
      AppError.buildOptions(
        {
          code: ENTITY_NOT_FOUND_CODE,
          category: ErrorCategory.NOT_FOUND,
          params: { ...parameters },
        },
        options,
      ),
    );
  }
}
