import { AppError, ErrorCategory } from '@task1/shared/errors/index';

export class ImportShuttingDownError extends AppError {
  public constructor() {
    super('Import was refused because the service is shutting down', {
      code: 'IMPORT_SHUTTING_DOWN',
      category: ErrorCategory.INTERNAL,
    });
  }
}
