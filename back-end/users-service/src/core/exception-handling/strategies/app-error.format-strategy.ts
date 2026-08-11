import { Injectable } from '@nestjs/common';

import { AppError } from '../../errors';
import { IErrorFormatStrategy, IFormattedError } from '../error-format.strategy.interface';
import { statusFromAppError } from '../status-from-app-error.utility';

@Injectable()
export class AppErrorFormatStrategy implements IErrorFormatStrategy {
  public canHandle(exception: unknown): exception is AppError {
    return exception instanceof AppError;
  }

  public format(exception: AppError): IFormattedError {
    return {
      statusCode: statusFromAppError(exception),
      error: {
        code: exception.code,
        category: exception.category,
        message: exception.message,
        details: [exception.toDetail()],
      },
    };
  }
}
