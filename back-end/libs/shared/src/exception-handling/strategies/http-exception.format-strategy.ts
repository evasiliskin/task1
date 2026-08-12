import { HttpException, Injectable } from '@nestjs/common';

import { IErrorFormatStrategy, IFormattedError } from '../error-format.strategy.interface';

interface IHttpErrorResponseBody {
  message?: unknown;
}

@Injectable()
export class HttpExceptionFormatStrategy implements IErrorFormatStrategy {
  public canHandle(exception: unknown): exception is HttpException {
    return exception instanceof HttpException;
  }

  public format(exception: HttpException): IFormattedError {
    const statusCode = exception.getStatus();
    const responseBody: unknown = exception.getResponse();

    return {
      statusCode,
      error: {
        code: `HTTP_${statusCode}`,
        message: this.resolveMessage(responseBody, exception.message),
      },
    };
  }

  private resolveMessage(responseBody: unknown, fallback: string): string {
    if (typeof responseBody === 'string') {
      return responseBody;
    }

    if (typeof responseBody === 'object' && responseBody !== null) {
      const { message } = responseBody as IHttpErrorResponseBody;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message) && typeof message[0] === 'string') {
        return message.join(', ');
      }
    }

    return fallback;
  }
}
