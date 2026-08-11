import { AppError } from '../base/app-error';
import { ErrorCategory } from '../error-category.enum';

import { ConflictError } from './conflict-error';

export const VERSION_MISMATCH_CODE = 'VERSION_MISMATCH';

export interface IVersionMismatchErrorParameters {
  entityName: string;
  entityId: string;
  expectedVersion: number;
  currentVersion: number;
}

export class VersionMismatchError extends ConflictError {
  public constructor(parameters: IVersionMismatchErrorParameters, options?: { cause?: Error }) {
    const message = `${parameters.entityName} ${parameters.entityId} was modified by another request (expected version ${parameters.expectedVersion}, current version ${parameters.currentVersion})`;

    super(
      message,
      AppError.buildOptions(
        {
          code: VERSION_MISMATCH_CODE,
          category: ErrorCategory.CONFLICT,
          params: { ...parameters },
        },
        options,
      ),
    );
  }
}
