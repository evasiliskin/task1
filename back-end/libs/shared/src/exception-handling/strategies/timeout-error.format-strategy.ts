import { HttpStatus, Injectable } from '@nestjs/common';
import { TimeoutError } from 'rxjs';

import { IErrorFormatStrategy, IFormattedError } from '../error-format.strategy.interface.js';

@Injectable()
export class TimeoutErrorFormatStrategy implements IErrorFormatStrategy {
  public canHandle(exception: unknown): exception is TimeoutError {
    return exception instanceof TimeoutError;
  }

  public format(_exception: TimeoutError): IFormattedError {
    return {
      statusCode: HttpStatus.GATEWAY_TIMEOUT,
      error: {
        code: 'GATEWAY_TIMEOUT',
        message: 'The downstream service did not respond in time.',
      },
    };
  }
}
