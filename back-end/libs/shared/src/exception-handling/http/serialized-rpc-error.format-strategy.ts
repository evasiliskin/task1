import { Injectable } from '@nestjs/common';

import { IErrorFormatStrategy, IFormattedError } from '../error-format.strategy.interface.js';

interface ISerializedRpcError {
  statusCode: number;
  code: string;
  category?: string;
  message: string;
  details?: unknown[];
}

function isSerializedRpcError(value: unknown): value is ISerializedRpcError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).statusCode === 'number' &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

@Injectable()
export class SerializedRpcErrorFormatStrategy implements IErrorFormatStrategy {
  public canHandle(exception: unknown): exception is ISerializedRpcError {
    return isSerializedRpcError(exception);
  }

  public format(exception: ISerializedRpcError): IFormattedError {
    return {
      statusCode: exception.statusCode,
      error: {
        code: exception.code,
        category: exception.category,
        message: exception.message,
        details: exception.details as IFormattedError['error']['details'],
      },
    };
  }
}
