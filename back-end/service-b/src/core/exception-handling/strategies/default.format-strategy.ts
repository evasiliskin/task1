import { HttpStatus, Injectable } from '@nestjs/common';

import { IErrorFormatStrategy, IFormattedError } from '../error-format.strategy.interface';

@Injectable()
export class DefaultFormatStrategy implements IErrorFormatStrategy {
  public canHandle(_exception: unknown): boolean {
    return true;
  }

  public format(_exception: unknown): IFormattedError {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };
  }
}
