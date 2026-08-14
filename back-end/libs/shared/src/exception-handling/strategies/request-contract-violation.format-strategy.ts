import { HttpStatus, Injectable } from '@nestjs/common';

import { RequestContractViolationError } from '../../errors/index.js';
import {
  type IErrorFormatStrategy,
  type IFormattedError,
} from '../error-format.strategy.interface.js';

@Injectable()
export class RequestContractViolationFormatStrategy implements IErrorFormatStrategy {
  public canHandle(exception: unknown): exception is RequestContractViolationError {
    return exception instanceof RequestContractViolationError;
  }

  public format(exception: RequestContractViolationError): IFormattedError {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      error: {
        code: exception.code,
        category: exception.category,
        message: exception.message,
        fieldErrors: exception.fieldErrors,
      },
    };
  }
}
